const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || '');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.static(__dirname));
app.use('/images', express.static('images'));

// Body parser - but skip multipart/form-data (multer handles that)
app.use((req, res, next) => {
    if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
        return next(); // Skip body-parser for multipart
    }
    bodyParser.json()(req, res, next);
});

app.use((req, res, next) => {
    if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
        return next(); // Skip body-parser for multipart
    }
    bodyParser.urlencoded({ extended: true, limit: '10mb' })(req, res, next);
});

// Ensure images directory exists
const imagesDir = path.join(__dirname, 'images');
if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
}

// Configure multer for image uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'images/');
    },
    filename: function (req, file, cb) {
        // Generate a safe filename with timestamp and random number
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        // Get original extension and sanitize it
        const ext = path.extname(file.originalname).toLowerCase();
        // Create filename: carId-images-timestamp-random.ext
        const carId = req.params.id || 'car';
        const filename = `${carId}-images-${uniqueSuffix}${ext}`;
        cb(null, filename);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { 
        fileSize: 10 * 1024 * 1024, // 10MB limit per file
        files: 10 // Maximum 10 files
    },
    fileFilter: function (req, file, cb) {
        try {
            // Allowed file extensions
            const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
            // Allowed MIME types
            const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
            
            // Get file extension
            const fileExt = path.extname(file.originalname).toLowerCase();
            
            // Check extension
            const hasValidExtension = allowedExtensions.includes(fileExt);
            
            // Check MIME type
            const hasValidMimeType = allowedMimeTypes.includes(file.mimetype.toLowerCase());
            
            if (hasValidExtension && hasValidMimeType) {
                cb(null, true);
            } else {
                cb(new Error(`Invalid file type. Allowed types: ${allowedExtensions.join(', ')}`));
            }
        } catch (error) {
            cb(new Error('Error validating file: ' + error.message));
        }
    }
});

// Car inventory data file
const inventoryFile = path.join(__dirname, 'inventory.json');

// Initialize inventory if it doesn't exist
function initializeInventory() {
    if (!fs.existsSync(inventoryFile)) {
        const initialInventory = {
            cars: [
                {
                    id: 1,
                    name: "Toyota Camry",
                    model: "Camry",
                    price: 60,
                    year: "2024",
                    seats: "5",
                    transmission: "Automatic",
                    fuel: "Gasoline",
                    mileage: "Unlimited",
                    features: "Bluetooth, Navigation, Backup Camera, Apple CarPlay",
                    quantity: 1,
                    available: 1,
                    images: []
                },
                {
                    id: 2,
                    name: "Toyota RAV4",
                    model: "RAV4",
                    price: 70,
                    year: "2024",
                    seats: "5",
                    transmission: "Automatic",
                    fuel: "Gasoline",
                    mileage: "Unlimited",
                    features: "All-Wheel Drive, Apple CarPlay, Safety Sense, Panoramic Roof",
                    quantity: 3,
                    available: 3,
                    images: []
                }
            ],
            bookings: []
        };
        fs.writeFileSync(inventoryFile, JSON.stringify(initialInventory, null, 2));
    }
}

// Load inventory
function loadInventory() {
    initializeInventory();
    return JSON.parse(fs.readFileSync(inventoryFile, 'utf8'));
}

// Save inventory
function saveInventory(inventory) {
    fs.writeFileSync(inventoryFile, JSON.stringify(inventory, null, 2));
}

// Email configuration
// NOTE: You'll need to configure this with your actual email credentials
// For Gmail, you'll need an App Password: https://support.google.com/accounts/answer/185833
const createTransporter = () => {
    return nodemailer.createTransport({
        service: 'gmail', // Change to your email service
        auth: {
            user: process.env.EMAIL_USER || 'esdyamicrental@gmail.com', // Your email
            pass: process.env.EMAIL_PASS || 'Semilore@123' // Your email password or app password
        }
    });
};

// Generate invoice HTML
function generateInvoiceHTML(booking) {
    const days = Math.ceil((new Date(booking.returnDate) - new Date(booking.pickupDate)) / (1000 * 60 * 60 * 24));
    const subtotal = days * booking.pricePerDay;
    const tax = subtotal * 0.08; // 8% tax
    const total = subtotal + tax;

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .invoice-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
            .detail-row:last-child { border-bottom: none; }
            .total { font-size: 1.5em; font-weight: bold; color: #667eea; margin-top: 20px; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 0.9em; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>ES Dynamic Rentals</h1>
                <p>Booking Confirmation & Invoice</p>
            </div>
            <div class="content">
                <h2>Thank you for your booking, ${booking.firstName}!</h2>
                <p>Your reservation has been confirmed. Below are your booking details:</p>
                
                <div class="invoice-details">
                    <h3>Booking Information</h3>
                    <div class="detail-row">
                        <span><strong>Booking ID:</strong></span>
                        <span>#${booking.bookingId}</span>
                    </div>
                    <div class="detail-row">
                        <span><strong>Vehicle:</strong></span>
                        <span>${booking.carName}</span>
                    </div>
                    <div class="detail-row">
                        <span><strong>Pickup Date:</strong></span>
                        <span>${new Date(booking.pickupDate).toLocaleDateString()}</span>
                    </div>
                    <div class="detail-row">
                        <span><strong>Return Date:</strong></span>
                        <span>${new Date(booking.returnDate).toLocaleDateString()}</span>
                    </div>
                    <div class="detail-row">
                        <span><strong>Rental Period:</strong></span>
                        <span>${days} day(s)</span>
                    </div>
                    <div class="detail-row">
                        <span><strong>Pickup Location:</strong></span>
                        <span>${booking.pickupLocation}</span>
                    </div>
                </div>

                <div class="invoice-details">
                    <h3>Customer Information</h3>
                    <div class="detail-row">
                        <span><strong>Name:</strong></span>
                        <span>${booking.firstName} ${booking.lastName}</span>
                    </div>
                    <div class="detail-row">
                        <span><strong>Email:</strong></span>
                        <span>${booking.email}</span>
                    </div>
                    <div class="detail-row">
                        <span><strong>Phone:</strong></span>
                        <span>${booking.phone}</span>
                    </div>
                </div>

                <div class="invoice-details">
                    <h3>Pricing</h3>
                    <div class="detail-row">
                        <span>Daily Rate:</span>
                        <span>$${booking.pricePerDay}/day</span>
                    </div>
                    <div class="detail-row">
                        <span>Rental Days:</span>
                        <span>${days} day(s)</span>
                    </div>
                    <div class="detail-row">
                        <span>Subtotal:</span>
                        <span>$${subtotal.toFixed(2)}</span>
                    </div>
                    <div class="detail-row">
                        <span>Tax (8%):</span>
                        <span>$${tax.toFixed(2)}</span>
                    </div>
                    <div class="detail-row total">
                        <span>Total:</span>
                        <span>$${total.toFixed(2)}</span>
                    </div>
                </div>

                ${booking.additionalInfo ? `
                <div class="invoice-details">
                    <h3>Additional Information</h3>
                    <p>${booking.additionalInfo}</p>
                </div>
                ` : ''}

                <div class="footer">
                    <p><strong>ES Dynamic Rentals</strong></p>
                    <p>1460 South Canton Avenue, Tulsa, Oklahoma 74137</p>
                    <p>Phone: 918-204-8691 | Email: esdyamicrental@gmail.com</p>
                    <p>Please arrive 15 minutes before your scheduled pickup time.</p>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;
}

// API Routes

// Get all cars with availability
app.get('/api/cars', (req, res) => {
    try {
        const inventory = loadInventory();
        const carsWithStatus = inventory.cars.map(car => ({
            ...car,
            price: `$${car.price}/day`,
            availability: car.available > 0 ? (car.available < car.quantity ? 'limited' : 'available') : 'unavailable',
            image: car.images && car.images.length > 0 ? `/images/${car.images[0]}` : null
        }));
        res.json(carsWithStatus);
    } catch (error) {
        res.status(500).json({ error: 'Failed to load cars' });
    }
});

// Get single car
app.get('/api/cars/:id', (req, res) => {
    try {
        const inventory = loadInventory();
        const car = inventory.cars.find(c => c.id === parseInt(req.params.id));
        if (!car) {
            return res.status(404).json({ error: 'Car not found' });
        }
        const carWithStatus = {
            ...car,
            price: `$${car.price}/day`,
            availability: car.available > 0 ? (car.available < car.quantity ? 'limited' : 'available') : 'unavailable',
            images: car.images.map(img => `/images/${img}`)
        };
        res.json(carWithStatus);
    } catch (error) {
        res.status(500).json({ error: 'Failed to load car' });
    }
});

// Upload images for a car
// This route must be before body-parser processes it
app.post('/api/cars/:id/images', (req, res, next) => {
    // Log request for debugging
    console.log('Upload request received:', {
        carId: req.params.id,
        contentType: req.headers['content-type']
    });
    
    // Use multer middleware directly
    const uploadMiddleware = upload.array('images', 10);
    uploadMiddleware(req, res, (err) => {
        if (err) {
            console.error('Multer error:', err);
            console.error('Error code:', err.code);
            console.error('Error field:', err.field);
            
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
                }
                if (err.code === 'LIMIT_FILE_COUNT') {
                    return res.status(400).json({ error: 'Too many files. Maximum is 10 files.' });
                }
                if (err.code === 'LIMIT_UNEXPECTED_FILE') {
                    return res.status(400).json({ 
                        error: `Unexpected field name "${err.field}". Please use field name "images".` 
                    });
                }
                return res.status(400).json({ error: err.message || 'Upload error occurred' });
            }
            // Handle fileFilter errors
            return res.status(400).json({ error: err.message || 'Invalid file type' });
        }
        
        try {
            console.log('Files received:', req.files ? req.files.length : 0);
            
            const inventory = loadInventory();
            const car = inventory.cars.find(c => c.id === parseInt(req.params.id));
            
            if (!car) {
                return res.status(404).json({ error: 'Car not found' });
            }

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ error: 'No images uploaded' });
            }

            const uploadedFiles = req.files.map(file => file.filename);
            car.images = [...(car.images || []), ...uploadedFiles];
            
            saveInventory(inventory);
            console.log('Upload successful:', uploadedFiles);
            res.json({ 
                message: 'Images uploaded successfully',
                images: car.images.map(img => `/images/${img}`)
            });
        } catch (error) {
            console.error('Upload processing error:', error);
            res.status(500).json({ error: error.message || 'Failed to upload images' });
        }
    });
});

// Create payment intent
app.post('/api/create-payment-intent', async (req, res) => {
    try {
        const { carId, pickupDate, returnDate } = req.body;
        
        const inventory = loadInventory();
        const car = inventory.cars.find(c => c.id === parseInt(carId));
        
        if (!car) {
            return res.status(404).json({ error: 'Car not found' });
        }

        // Calculate total
        const pickup = new Date(pickupDate);
        const returnD = new Date(returnDate);
        const days = Math.ceil((returnD - pickup) / (1000 * 60 * 60 * 24));
        const subtotal = days * car.price;
        const tax = subtotal * 0.08;
        const total = Math.round((subtotal + tax) * 100); // Convert to cents

        if (!stripe || !process.env.STRIPE_SECRET_KEY) {
            return res.status(500).json({ error: 'Stripe is not configured. Please add STRIPE_SECRET_KEY to your environment variables.' });
        }

        const paymentIntent = await stripe.paymentIntents.create({
            amount: total,
            currency: 'usd',
            metadata: {
                carId: car.id.toString(),
                carName: car.name,
                pickupDate,
                returnDate,
                days: days.toString()
            }
        });

        res.json({ 
            clientSecret: paymentIntent.client_secret,
            amount: total / 100
        });
    } catch (error) {
        console.error('Payment intent error:', error);
        res.status(500).json({ error: 'Failed to create payment intent' });
    }
});

// Create booking (after payment)
app.post('/api/bookings', async (req, res) => {
    try {
        const inventory = loadInventory();
        const { carId, firstName, lastName, email, phone, pickupDate, returnDate, pickupLocation, additionalInfo, paymentIntentId } = req.body;

        const car = inventory.cars.find(c => c.id === parseInt(carId));
        if (!car) {
            return res.status(404).json({ error: 'Car not found' });
        }

        if (car.available <= 0) {
            return res.status(400).json({ error: 'Car is not available' });
        }

        // Check date validity
        const pickup = new Date(pickupDate);
        const returnD = new Date(returnDate);
        if (returnD <= pickup) {
            return res.status(400).json({ error: 'Return date must be after pickup date' });
        }

        // Create booking
        const bookingId = 'BK' + Date.now();
        const days = Math.ceil((returnD - pickup) / (1000 * 60 * 60 * 24));
        const subtotal = days * car.price;
        const tax = subtotal * 0.08;
        const total = subtotal + tax;

        // Verify payment if paymentIntentId is provided
        let paymentStatus = 'pending';
        if (paymentIntentId && stripe && process.env.STRIPE_SECRET_KEY) {
            try {
                const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
                paymentStatus = paymentIntent.status;
                if (paymentStatus !== 'succeeded') {
                    return res.status(400).json({ error: 'Payment not completed. Please complete the payment to confirm your booking.' });
                }
            } catch (paymentError) {
                console.error('Payment verification error:', paymentError);
                return res.status(400).json({ error: 'Payment verification failed. Please try again.' });
            }
        }

        const booking = {
            bookingId,
            carId: car.id,
            carName: car.name,
            firstName,
            lastName,
            email,
            phone,
            pickupDate,
            returnDate,
            pickupLocation,
            additionalInfo: additionalInfo || '',
            pricePerDay: car.price,
            days,
            subtotal,
            tax,
            total,
            paymentIntentId: paymentIntentId || null,
            paymentStatus,
            bookingDate: new Date().toISOString()
        };

        // Update availability
        car.available -= 1;
        inventory.bookings.push(booking);
        saveInventory(inventory);

        // Send email invoice to customer
        try {
            const transporter = createTransporter();
            const businessEmail = process.env.EMAIL_USER || 'esdyamicrental@gmail.com';
            
            // Send to customer
            const customerMailOptions = {
                from: businessEmail,
                to: email,
                subject: `Booking Confirmation #${bookingId} - ES Dynamic Rentals`,
                html: generateInvoiceHTML(booking),
                text: `Thank you for your booking, ${firstName}!\n\nBooking ID: ${bookingId}\nCar: ${car.name}\nPickup: ${pickupDate}\nReturn: ${returnDate}\nTotal: $${total.toFixed(2)}\n\nES Dynamic Rentals`
            };

            await transporter.sendMail(customerMailOptions);
            console.log(`Invoice email sent to customer: ${email}`);
            
            // Send copy to business
            const businessMailOptions = {
                from: businessEmail,
                to: businessEmail,
                subject: `New Booking Received #${bookingId} - ${car.name}`,
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>
                            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
                            .booking-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
                            .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
                            .detail-row:last-child { border-bottom: none; }
                            .total { font-size: 1.5em; font-weight: bold; color: #667eea; margin-top: 20px; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h1>New Booking Received</h1>
                                <p>Booking ID: #${bookingId}</p>
                            </div>
                            <div class="content">
                                <h2>Booking Details</h2>
                                
                                <div class="booking-details">
                                    <h3>Customer Information</h3>
                                    <div class="detail-row">
                                        <span><strong>Name:</strong></span>
                                        <span>${firstName} ${lastName}</span>
                                    </div>
                                    <div class="detail-row">
                                        <span><strong>Email:</strong></span>
                                        <span>${email}</span>
                                    </div>
                                    <div class="detail-row">
                                        <span><strong>Phone:</strong></span>
                                        <span>${phone}</span>
                                    </div>
                                </div>

                                <div class="booking-details">
                                    <h3>Rental Information</h3>
                                    <div class="detail-row">
                                        <span><strong>Vehicle:</strong></span>
                                        <span>${car.name}</span>
                                    </div>
                                    <div class="detail-row">
                                        <span><strong>Pickup Date:</strong></span>
                                        <span>${new Date(pickupDate).toLocaleDateString()}</span>
                                    </div>
                                    <div class="detail-row">
                                        <span><strong>Return Date:</strong></span>
                                        <span>${new Date(returnDate).toLocaleDateString()}</span>
                                    </div>
                                    <div class="detail-row">
                                        <span><strong>Rental Period:</strong></span>
                                        <span>${days} day(s)</span>
                                    </div>
                                    <div class="detail-row">
                                        <span><strong>Pickup Location:</strong></span>
                                        <span>${pickupLocation}</span>
                                    </div>
                                </div>

                                <div class="booking-details">
                                    <h3>Pricing</h3>
                                    <div class="detail-row">
                                        <span>Daily Rate:</span>
                                        <span>$${booking.pricePerDay}/day</span>
                                    </div>
                                    <div class="detail-row">
                                        <span>Rental Days:</span>
                                        <span>${days} day(s)</span>
                                    </div>
                                    <div class="detail-row">
                                        <span>Subtotal:</span>
                                        <span>$${subtotal.toFixed(2)}</span>
                                    </div>
                                    <div class="detail-row">
                                        <span>Tax (8%):</span>
                                        <span>$${tax.toFixed(2)}</span>
                                    </div>
                                    <div class="detail-row total">
                                        <span>Total:</span>
                                        <span>$${total.toFixed(2)}</span>
                                    </div>
                                </div>

                                ${additionalInfo ? `
                                <div class="booking-details">
                                    <h3>Additional Information</h3>
                                    <p>${additionalInfo}</p>
                                </div>
                                ` : ''}

                                <div class="booking-details">
                                    <p><strong>Booking Date:</strong> ${new Date(booking.bookingDate).toLocaleString()}</p>
                                </div>
                            </div>
                        </div>
                    </body>
                    </html>
                `,
                text: `New Booking Received\n\nBooking ID: ${bookingId}\nCustomer: ${firstName} ${lastName}\nEmail: ${email}\nPhone: ${phone}\nCar: ${car.name}\nPickup: ${pickupDate}\nReturn: ${returnDate}\nTotal: $${total.toFixed(2)}\n\nES Dynamic Rentals`
            };

            await transporter.sendMail(businessMailOptions);
            console.log(`Booking notification sent to business: ${businessEmail}`);
        } catch (emailError) {
            console.error('Failed to send email:', emailError);
            // Don't fail the booking if email fails
        }

        res.json({ 
            success: true, 
            booking,
            message: 'Booking confirmed! Invoice has been sent to your email.'
        });
    } catch (error) {
        console.error('Booking error:', error);
        res.status(500).json({ error: 'Failed to create booking' });
    }
});

// Get bookings (for admin)
app.get('/api/bookings', (req, res) => {
    try {
        const inventory = loadInventory();
        res.json(inventory.bookings);
    } catch (error) {
        res.status(500).json({ error: 'Failed to load bookings' });
    }
});

// Update car availability (for admin)
app.put('/api/cars/:id/availability', (req, res) => {
    try {
        const inventory = loadInventory();
        const car = inventory.cars.find(c => c.id === parseInt(req.params.id));
        
        if (!car) {
            return res.status(404).json({ error: 'Car not found' });
        }

        if (req.body.available !== undefined) {
            car.available = Math.max(0, Math.min(car.quantity, parseInt(req.body.available)));
        }
        if (req.body.quantity !== undefined) {
            const newQuantity = parseInt(req.body.quantity);
            car.quantity = newQuantity;
            car.available = Math.min(car.available, newQuantity);
        }

        saveInventory(inventory);
        res.json({ 
            message: 'Availability updated',
            car: {
                ...car,
                price: `$${car.price}/day`,
                availability: car.available > 0 ? (car.available < car.quantity ? 'limited' : 'available') : 'unavailable'
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update availability' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Make sure to configure EMAIL_USER and EMAIL_PASS environment variables for email functionality');
    initializeInventory();
});

