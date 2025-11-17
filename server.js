// Load environment variables
require('dotenv').config();

// Core modules
const fs = require('fs');
const path = require('path');

// Third-party modules
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const validator = require('validator');
const bcrypt = require('bcrypt');
const session = require('express-session');

// Try to load FileStore, but don't fail if it's not available
let FileStore = null;
try {
    FileStore = require('session-file-store')(session);
} catch (error) {
    console.log('ℹ️  session-file-store not available, will use MemoryStore');
}

// Initialize app
const app = express();

// Trust proxy - Required for Railway and other reverse proxy setups
// This allows Express to trust the X-Forwarded-For header from the proxy
app.set('trust proxy', true);

// Security Headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

// CORS Configuration - Restrict to specific origins
const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);
        // Check if origin is in allowed list
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            // Log for debugging
            console.log('CORS blocked origin:', origin);
            console.log('Allowed origins:', allowedOrigins);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});

const bookingLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 bookings per hour per IP
    message: 'Too many booking attempts. Please try again later.'
});

app.use('/api/', limiter);
app.use('/api/bookings', bookingLimiter);

// Body Parser
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Session Configuration - Use file store with fallback to MemoryStore
const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // HTTPS only in production
        httpOnly: true, // Prevents XSS attacks
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax' // Helps with CORS and redirects
    }
};

// Use MemoryStore (FileStore is optional and not needed on Railway)
// MemoryStore is fine for single-instance deployments
console.log('ℹ️  Using MemoryStore for sessions (suitable for Railway)');

app.use(session(sessionConfig));

// Ensure images directory exists
const imagesDir = path.join(__dirname, 'images');
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

// Multer setup for image uploads with security
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'images/'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname).toLowerCase();
        // Sanitize carId to prevent path traversal
        const carId = parseInt(req.params.id) || 0;
        if (isNaN(carId) || carId <= 0) {
            return cb(new Error('Invalid car ID'));
        }
        const safeCarId = carId.toString().replace(/[^0-9]/g, '');
        cb(null, `${safeCarId}-images-${uniqueSuffix}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
        files: 10 // Max 10 files
    },
    fileFilter: (req, file, cb) => {
        // Only allow image files
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error('Only image files (jpeg, jpg, png, gif, webp) are allowed'));
        }
    }
});

// Admin credentials (in production, store hashed password in database)
const ADMIN_USERNAME = 'Admin';
const ADMIN_PASSWORD_HASH = bcrypt.hashSync('Adekunle0987', 10); // Hash the password

// Authentication middleware for admin endpoints
const authenticateAdmin = (req, res, next) => {
    if (req.session && req.session.isAdmin) {
        return next();
    }
    return res.status(401).json({ error: 'Unauthorized. Please log in as admin.' });
};

// Admin login endpoint
app.post('/api/admin/login', [
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: 'Validation failed', details: errors.array() });
        }
        
        const { username, password } = req.body;
        
        // Check credentials
        if (username === ADMIN_USERNAME && bcrypt.compareSync(password, ADMIN_PASSWORD_HASH)) {
            req.session.isAdmin = true;
            req.session.username = username;
            return res.json({ 
                message: 'Login successful',
                username: username
            });
        } else {
            return res.status(401).json({ error: 'Invalid username or password' });
        }
    } catch (error) {
        console.error('Login error:', error);
        console.error('Error stack:', error.stack);
        // Don't expose internal error details in production
        const errorMessage = process.env.NODE_ENV === 'production' 
            ? 'Login failed. Please try again or contact support.'
            : error.message;
        res.status(500).json({ error: errorMessage });
    }
});

// Admin logout endpoint
app.post('/api/admin/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.json({ message: 'Logged out successfully' });
    });
});

// Check admin session
app.get('/api/admin/check', (req, res) => {
    if (req.session && req.session.isAdmin) {
        res.json({ 
            isAdmin: true, 
            username: req.session.username 
        });
    } else {
        res.json({ isAdmin: false });
    }
});

// Inventory file
const inventoryFile = path.join(__dirname, 'inventory.json');

function initializeInventory() {
    try {
        if (!fs.existsSync(inventoryFile)) {
            const initialInventory = {
                cars: [
                    { id: 1, name: "Toyota Camry", price: 60, quantity: 1, available: 1, images: [] },
                    { id: 2, name: "Toyota RAV4", price: 70, quantity: 3, available: 3, images: [] }
                ],
                bookings: []
            };
            fs.writeFileSync(inventoryFile, JSON.stringify(initialInventory, null, 2));
            console.log('✅ Created initial inventory.json');
        } else {
            console.log('✅ Inventory file exists');
        }
    } catch (error) {
        console.error('❌ Error initializing inventory:', error);
        // Don't crash - inventory will be created on first write
    }
}

function loadInventory() {
    initializeInventory();
    return JSON.parse(fs.readFileSync(inventoryFile, 'utf8'));
}

function saveInventory(inv) {
    fs.writeFileSync(inventoryFile, JSON.stringify(inv, null, 2));
}

// Serve static files from "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// Serve images folder
app.use('/images', express.static(path.join(__dirname, 'images')));

// Health check endpoint for Railway
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API info route (not root, to avoid interfering with static files)
app.get('/api', (req, res) => {
    res.json({ 
        message: 'ES Dynamic Rentals API is running!',
        endpoints: {
            cars: '/api/cars',
            bookings: '/api/bookings',
            admin: '/api/admin'
        }
    });
});

// Email transporter
const createTransporter = () => {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.warn('⚠️  Email credentials not configured. Email functionality will be disabled.');
        return null;
    }
    return nodemailer.createTransport({
        service: 'gmail',
        auth: { 
            user: process.env.EMAIL_USER, 
            pass: process.env.EMAIL_PASS 
        }
    });
};

// Demo email route
app.post('/api/send-demo-email', async (req, res) => {
    const { name, email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        const transporter = createTransporter();
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Demo Email',
            html: `<h2>Hello ${name || 'there'}!</h2><p>This is a demo email.</p>`
        });
        res.json({ message: 'Demo email sent!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to send email' });
    }
});

// Get all cars
app.get('/api/cars', (req, res) => {
    try {
        const inventory = loadInventory();
        res.json(inventory.cars.map(car => ({
            ...car,
            price: `$${car.price}/day`,
            availability: car.available > 0 ? 'available' : 'unavailable',
            image: car.images && car.images.length > 0 ? `/images/${car.images[0]}` : '/images/placeholder.png',
            images: car.images && car.images.length > 0 ? car.images.map(img => `/images/${img}`) : []
        })));
    } catch (err) {
        res.status(500).json({ error: 'Failed to load cars' });
    }
});

// Get single car
app.get('/api/cars/:id', (req, res) => {
    try {
        const inventory = loadInventory();
        const car = inventory.cars.find(c => c.id === parseInt(req.params.id));
        if (!car) return res.status(404).json({ error: 'Car not found' });
        
        // Return formatted car object matching the /api/cars structure
        res.json({
            ...car,
            price: `$${car.price}/day`,
            availability: car.available > 0 ? 'available' : 'unavailable',
            image: car.images && car.images.length > 0 ? `/images/${car.images[0]}` : '/images/placeholder.png',
            images: car.images && car.images.length > 0 ? car.images.map(img => `/images/${img}`) : []
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load car' });
    }
});

// Upload car images (Admin only)
app.post('/api/cars/:id/images', authenticateAdmin, (req, res) => {
    const uploadMiddleware = upload.array('images', 10);
    uploadMiddleware(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        try {
            const inventory = loadInventory();
            const car = inventory.cars.find(c => c.id === parseInt(req.params.id));
            if (!car) return res.status(404).json({ error: 'Car not found' });

            const files = req.files.map(f => f.filename);
            car.images = [...(car.images || []), ...files];
            saveInventory(inventory);
            res.json({ message: 'Images uploaded', images: car.images });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
});

// Add new car (Admin only)
app.post('/api/cars', authenticateAdmin, [
    body('name').trim().isLength({ min: 1, max: 100 }).escape().withMessage('Car name is required'),
    body('model').optional().trim().isLength({ max: 100 }).escape(),
    body('trim').optional().trim().isLength({ max: 200 }).escape(),
    body('price').isInt({ min: 1 }).withMessage('Price must be a positive number'),
    body('year').optional().trim().isLength({ max: 10 }).escape(),
    body('seats').optional().trim().isLength({ max: 10 }).escape(),
    body('transmission').optional().trim().isLength({ max: 50 }).escape(),
    body('fuel').optional().trim().isLength({ max: 50 }).escape(),
    body('mileage').optional().trim().isLength({ max: 100 }).escape(),
    body('features').optional().trim().isLength({ max: 500 }).escape(),
    body('color').optional().trim().isLength({ max: 100 }).escape(),
    body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
    body('available').isInt({ min: 0 }).withMessage('Available must be 0 or greater')
], (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: 'Validation failed', details: errors.array() });
        }
        
        const inventory = loadInventory();
        
        // Find the highest ID and add 1
        const maxId = inventory.cars.length > 0 
            ? Math.max(...inventory.cars.map(c => c.id))
            : 0;
        const newId = maxId + 1;
        
        const newCar = {
            id: newId,
            name: req.body.name,
            model: req.body.model || '',
            trim: req.body.trim || '',
            price: parseInt(req.body.price),
            year: req.body.year || '',
            seats: req.body.seats || '',
            transmission: req.body.transmission || '',
            fuel: req.body.fuel || '',
            mileage: req.body.mileage || '',
            features: req.body.features || '',
            color: req.body.color || '',
            quantity: parseInt(req.body.quantity),
            available: parseInt(req.body.available),
            images: []
        };
        
        inventory.cars.push(newCar);
        saveInventory(inventory);
        
        res.json({
            message: 'Car added successfully',
            car: {
                ...newCar,
                price: `$${newCar.price}/day`,
                availability: newCar.available > 0 ? 'available' : 'unavailable',
                image: '/images/placeholder.png'
            }
        });
    } catch (error) {
        console.error('Add car error:', error);
        res.status(500).json({ error: error.message || 'Failed to add car' });
    }
});

// Update car details (Admin only)
app.put('/api/cars/:id', authenticateAdmin, [
    body('name').optional().trim().isLength({ min: 1, max: 100 }).escape().withMessage('Car name must be 1-100 characters'),
    body('model').optional().trim().isLength({ max: 100 }).escape(),
    body('trim').optional().trim().isLength({ max: 200 }).escape(),
    body('price').optional().isInt({ min: 1 }).withMessage('Price must be a positive number'),
    body('year').optional().trim().isLength({ max: 10 }).escape(),
    body('seats').optional().trim().isLength({ max: 10 }).escape(),
    body('transmission').optional().trim().isLength({ max: 50 }).escape(),
    body('fuel').optional().trim().isLength({ max: 50 }).escape(),
    body('mileage').optional().trim().isLength({ max: 100 }).escape(),
    body('features').optional().trim().isLength({ max: 500 }).escape(),
    body('color').optional().trim().isLength({ max: 100 }).escape(),
    body('quantity').optional().isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
    body('available').optional().isInt({ min: 0 }).withMessage('Available must be 0 or greater')
], (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: 'Validation failed', details: errors.array() });
        }
        
        const inventory = loadInventory();
        const carId = parseInt(req.params.id);
        
        const car = inventory.cars.find(c => c.id === carId);
        if (!car) {
            return res.status(404).json({ error: 'Car not found' });
        }
        
        // Update only provided fields
        if (req.body.name !== undefined) car.name = req.body.name;
        if (req.body.model !== undefined) car.model = req.body.model;
        if (req.body.trim !== undefined) car.trim = req.body.trim;
        if (req.body.price !== undefined) car.price = parseInt(req.body.price);
        if (req.body.year !== undefined) car.year = req.body.year;
        if (req.body.seats !== undefined) car.seats = req.body.seats;
        if (req.body.transmission !== undefined) car.transmission = req.body.transmission;
        if (req.body.fuel !== undefined) car.fuel = req.body.fuel;
        if (req.body.mileage !== undefined) car.mileage = req.body.mileage;
        if (req.body.features !== undefined) car.features = req.body.features;
        if (req.body.color !== undefined) car.color = req.body.color;
        if (req.body.quantity !== undefined) car.quantity = parseInt(req.body.quantity);
        if (req.body.available !== undefined) car.available = parseInt(req.body.available);
        
        // Ensure available doesn't exceed quantity
        if (car.available > car.quantity) {
            car.available = car.quantity;
        }
        
        saveInventory(inventory);
        
        res.json({
            message: 'Car updated successfully',
            car: {
                ...car,
                price: `$${car.price}/day`,
                availability: car.available > 0 ? 'available' : 'unavailable',
                image: car.images && car.images.length > 0 ? `/images/${car.images[0]}` : '/images/placeholder.png'
            }
        });
    } catch (error) {
        console.error('Update car error:', error);
        res.status(500).json({ error: error.message || 'Failed to update car' });
    }
});

// Delete car (Admin only)
app.delete('/api/cars/:id', authenticateAdmin, (req, res) => {
    try {
        const inventory = loadInventory();
        const carId = parseInt(req.params.id);
        
        const carIndex = inventory.cars.findIndex(c => c.id === carId);
        if (carIndex === -1) {
            return res.status(404).json({ error: 'Car not found' });
        }
        
        // Remove car from inventory
        inventory.cars.splice(carIndex, 1);
        
        // Also remove any bookings for this car (optional - you might want to keep them)
        // inventory.bookings = inventory.bookings.filter(b => b.carId !== carId);
        
        saveInventory(inventory);
        
        res.json({ message: 'Car deleted successfully' });
    } catch (error) {
        console.error('Delete car error:', error);
        res.status(500).json({ error: error.message || 'Failed to delete car' });
    }
});

// Update car availability (Admin only)
app.put('/api/cars/:id/availability', authenticateAdmin, (req, res) => {
    try {
        const { available, quantity } = req.body;
        
        if (typeof available !== 'number' || typeof quantity !== 'number') {
            return res.status(400).json({ error: 'Available and quantity must be numbers' });
        }
        
        if (available < 0 || quantity < 0) {
            return res.status(400).json({ error: 'Available and quantity must be non-negative' });
        }
        
        if (available > quantity) {
            return res.status(400).json({ error: 'Available cannot exceed total quantity' });
        }
        
        const inventory = loadInventory();
        const car = inventory.cars.find(c => c.id === parseInt(req.params.id));
        if (!car) return res.status(404).json({ error: 'Car not found' });
        
        car.available = available;
        car.quantity = quantity;
        
        saveInventory(inventory);
        res.json({ 
            message: 'Availability updated successfully',
            car: {
                ...car,
                price: `$${car.price}/day`,
                availability: car.available > 0 ? 'available' : 'unavailable',
                image: car.images && car.images.length > 0 ? `/images/${car.images[0]}` : '/images/placeholder.png'
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to update availability' });
    }
});

// Escape HTML to prevent XSS
function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.toString().replace(/[&<>"']/g, m => map[m]);
}

// Generate invoice HTML
function generateInvoiceHTML(booking) {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
        .invoice-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e0e0e0; }
        .detail-row:last-child { border-bottom: none; }
        .label { font-weight: 600; color: #667eea; }
        .total { font-size: 1.3em; font-weight: 700; color: #667eea; margin-top: 20px; padding-top: 20px; border-top: 2px solid #667eea; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>ES Dynamic Rentals</h1>
            <h2>Booking Invoice</h2>
        </div>
        <div class="content">
            <div class="invoice-details">
                <div class="detail-row">
                    <span class="label">Booking ID:</span>
                    <span>${booking.bookingId}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Customer Name:</span>
                    <span>${booking.firstName} ${booking.lastName}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Email:</span>
                    <span>${booking.email}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Phone:</span>
                    <span>${booking.phone}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Car:</span>
                    <span>${booking.carName}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Pickup Date:</span>
                    <span>${new Date(booking.pickupDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Return Date:</span>
                    <span>${new Date(booking.returnDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Rental Period:</span>
                    <span>${booking.days} day(s)</span>
                </div>
                <div class="detail-row">
                    <span class="label">Pickup Location:</span>
                    <span>1460 South Canton Avenue, Tulsa, Oklahoma 74137</span>
                </div>
                ${booking.additionalInfo ? `
                <div class="detail-row">
                    <span class="label">Additional Info:</span>
                    <span>${escapeHtml(booking.additionalInfo)}</span>
                </div>
                ` : ''}
                <div class="detail-row">
                    <span class="label">Price per Day:</span>
                    <span>$${booking.pricePerDay.toFixed(2)}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Subtotal (${booking.days} days):</span>
                    <span>$${booking.subtotal.toFixed(2)}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Tax (8%):</span>
                    <span>$${booking.tax.toFixed(2)}</span>
                </div>
                <div class="total detail-row">
                    <span>Total Amount:</span>
                    <span>$${booking.total.toFixed(2)}</span>
                </div>
            </div>
            <div style="background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; color: #856404; font-weight: 600; font-size: 1rem;">
                    ⚠️ Payment Required at Pickup
                </p>
                <p style="margin: 8px 0 0 0; color: #856404; font-size: 0.95rem;">
                    This is a reservation confirmation. Payment must be completed at our location when you pick up the vehicle. Please bring a valid ID and payment method.
                </p>
            </div>
            <div class="footer">
                <p>Thank you for choosing ES Dynamic Rentals!</p>
                <p>For any questions, contact us at:<br>
                Phone: 918-204-8691<br>
                Email: esdynamicrental@gmail.com</p>
            </div>
        </div>
    </div>
</body>
</html>
    `;
}

// Create booking with input validation
app.post('/api/bookings', [
    body('carId').isInt({ min: 1 }).withMessage('Invalid car ID'),
    body('firstName').trim().isLength({ min: 1, max: 50 }).escape().withMessage('First name must be 1-50 characters'),
    body('lastName').trim().isLength({ min: 1, max: 50 }).escape().withMessage('Last name must be 1-50 characters'),
    body('email').isEmail().normalizeEmail().withMessage('Invalid email address'),
    body('phone').trim().matches(/^[\d\s\-\+\(\)]+$/).isLength({ min: 10, max: 20 }).withMessage('Invalid phone number'),
    body('pickupDate').isISO8601().withMessage('Invalid pickup date'),
    body('returnDate').isISO8601().withMessage('Invalid return date'),
    body('pickupLocation').trim().isLength({ min: 1, max: 100 }).escape().withMessage('Invalid pickup location'),
    body('additionalInfo').optional().trim().isLength({ max: 500 }).escape().withMessage('Additional info too long')
], async (req, res) => {
    try {
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                error: 'Validation failed', 
                details: errors.array() 
            });
        }
        
        const { carId, firstName, lastName, email, phone, pickupDate, returnDate, pickupLocation, additionalInfo } = req.body;
        
        const inventory = loadInventory();
        const car = inventory.cars.find(c => c.id === parseInt(carId));
        if (!car) return res.status(404).json({ error: 'Car not found' });
        
        // Check availability
        if (car.available <= 0) {
            return res.status(400).json({ error: 'Car is not available' });
        }
        
        // Calculate rental period
        const pickup = new Date(pickupDate);
        const returnD = new Date(returnDate);
        const days = Math.ceil((returnD - pickup) / (1000 * 60 * 60 * 24));
        
        if (days <= 0) {
            return res.status(400).json({ error: 'Return date must be after pickup date' });
        }
        
        // Calculate pricing
        const pricePerDay = car.price;
        const subtotal = pricePerDay * days;
        const tax = subtotal * 0.08; // 8% tax
        const total = subtotal + tax;
        
        // Create booking
        const booking = {
            bookingId: `BK${Date.now()}`,
            carId: parseInt(carId),
            carName: car.name,
            firstName,
            lastName,
            email,
            phone,
            pickupDate,
            returnDate,
            pickupLocation,
            additionalInfo: additionalInfo || '',
            pricePerDay,
            days,
            subtotal,
            tax,
            total,
            paymentStatus: 'pending',
            bookingDate: new Date().toISOString()
        };
        
        // Add booking to inventory
        inventory.bookings = inventory.bookings || [];
        inventory.bookings.push(booking);
        
        // Decrease car availability
        car.available = Math.max(0, car.available - 1);
        
        // Save inventory
        saveInventory(inventory);
        
        // Send invoice emails
        const transporter = createTransporter();
        if (transporter) {
            const invoiceHTML = generateInvoiceHTML(booking);
            const emailSubject = `Booking Confirmation - ${booking.bookingId} - ES Dynamic Rentals`;
            
            // Send to customer
            try {
                await transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: email,
                    subject: emailSubject,
                    html: invoiceHTML
                });
                console.log(`✅ Invoice sent to customer: ${email}`);
            } catch (emailError) {
                console.error('Error sending email to customer:', emailError);
            }
            
            // Send to esdynamicrental@gmail.com
            try {
                await transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: 'esdynamicrental@gmail.com',
                    subject: `New Booking: ${booking.bookingId} - ${booking.carName}`,
                    html: invoiceHTML
                });
                console.log(`✅ Invoice sent to esdynamicrental@gmail.com`);
            } catch (emailError) {
                console.error('Error sending email to esdynamicrental:', emailError);
            }
        } else {
            console.warn('⚠️  Email not configured. Invoice emails not sent.');
        }
        
        res.json({
            message: 'Reservation confirmed! An invoice has been sent to your email. Please complete payment at our location when you pick up the vehicle.',
            booking
        });
    } catch (error) {
        console.error('Booking error:', error);
        // Don't expose internal error details in production
        const errorMessage = process.env.NODE_ENV === 'production' 
            ? 'Failed to create booking. Please try again or contact support.'
            : error.message;
        res.status(500).json({ error: errorMessage });
    }
});

// Optional: catch-all route for SPA (must be last - after all API routes!)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server with error handling
const PORT = process.env.PORT || 3000;

// Handle uncaught errors to prevent crashes
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    console.error('Stack:', error.stack);
    // Don't exit - let Railway handle it
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit - let Railway handle it
});

// Initialize inventory before starting server
try {
    initializeInventory();
} catch (error) {
    console.error('⚠️  Warning: Could not initialize inventory:', error.message);
    // Continue anyway - inventory will be created on first use
}

// Start server
try {
    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`✅ Health check: http://0.0.0.0:${PORT}/health`);
        console.log('✅ Server ready to accept connections');
    });

    // Handle server errors
    server.on('error', (error) => {
        console.error('❌ Server error:', error);
        if (error.code === 'EADDRINUSE') {
            console.error(`Port ${PORT} is already in use`);
        }
    });
} catch (error) {
    console.error('❌ Failed to start server:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
}
