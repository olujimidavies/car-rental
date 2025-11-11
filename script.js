// API base URL - change this if your backend is on a different port
const API_BASE_URL = 'http://localhost:3000/api';

// Stripe - Initialize with your publishable key
// Get this from: https://dashboard.stripe.com/apikeys
// Replace 'pk_test_51Q...' with your actual Stripe Publishable Key
let stripe = null;
let elements = null;
let cardElement = null;
let paymentIntentClientSecret = null;
let currentPaymentIntentId = null;

// Initialize Stripe if available
try {
    if (typeof Stripe !== 'undefined') {
        // Replace this with your actual publishable key from Stripe Dashboard
        const publishableKey = 'pk_test_51Q...'; // TODO: Replace with your key
        if (publishableKey && publishableKey !== 'pk_test_51Q...') {
            stripe = Stripe(publishableKey);
        }
    }
} catch (error) {
    console.warn('Stripe not initialized:', error);
}

// Car data - will be loaded from API
let cars = [];
let currentSlide = 0;
let autoSlideInterval;
let currentPage = 'home';
let currentCarDetailId = null;
let currentGalleryImage = 0;

// Load cars from API
async function loadCars() {
    try {
        const response = await fetch(`${API_BASE_URL}/cars`);
        if (!response.ok) throw new Error('Failed to load cars');
        cars = await response.json();
        
        // Initialize UI after loading cars
        if (currentPage === 'home') {
            initSlideshow();
            startAutoSlide();
        } else if (currentPage === 'cars') {
            renderCarsListing();
        }
    } catch (error) {
        console.error('Error loading cars:', error);
        // Fallback: show error message
        const carsGrid = document.getElementById('carsGrid');
        if (carsGrid) {
            carsGrid.innerHTML = '<p style="text-align: center; color: red; padding: 40px;">Failed to load cars. Please make sure the server is running.</p>';
        }
    }
}

// Navigation function
function navigateTo(page, carId = null) {
    currentPage = page;
    
    // Stop auto-slide when leaving home page
    if (page !== 'home') {
        clearInterval(autoSlideInterval);
    }
    
    // Hide all pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    
    // Show selected page
    const pageMap = {
        'home': 'homePage',
        'cars': 'carsPage',
        'contact': 'contactPage',
        'carDetail': 'carDetailPage'
    };
    
    const pageId = pageMap[page];
    if (pageId) {
        const targetPage = document.getElementById(pageId);
        if (targetPage) {
            targetPage.classList.add('active');
            
            // Initialize page-specific content
            if (page === 'cars') {
                renderCarsListing();
            } else if (page === 'home') {
                // Restart auto-slide when returning to home
                if (cars.length > 0) {
                    initSlideshow();
                    startAutoSlide();
                }
            } else if (page === 'carDetail' && carId) {
                renderCarDetailPage(carId);
            }
        }
    }
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Render cars listing page
function renderCarsListing() {
    const carsGrid = document.getElementById('carsGrid');
    if (!carsGrid) return;
    
    carsGrid.innerHTML = '';
    
    if (cars.length === 0) {
        carsGrid.innerHTML = '<p style="text-align: center; padding: 40px;">No cars available at the moment.</p>';
        return;
    }
    
    cars.forEach(car => {
        const carCard = document.createElement('div');
        carCard.className = 'car-card';
        
        const availabilityText = {
            'available': 'Available',
            'limited': 'Limited',
            'unavailable': 'Unavailable'
        };
        
        const availabilityClass = car.availability || 'available';
        const imageSrc = car.image || '/images/placeholder.jpg';
        
        carCard.innerHTML = `
            <img src="${imageSrc}" alt="${car.name}" class="car-card-image" loading="lazy" onerror="this.src='/images/placeholder.jpg'">
            <div class="car-card-content">
                <div class="car-card-header">
                    <h3 class="car-card-name">${car.name}</h3>
                    <span class="availability-badge ${availabilityClass}">${availabilityText[availabilityClass]}</span>
                </div>
                <div class="car-card-price">${car.price}</div>
                <div class="car-card-specs">
                    <span>📅 ${car.year}</span>
                    <span>👥 ${car.seats} Seats</span>
                    <span>⚙️ ${car.transmission}</span>
                    <span>⛽ ${car.fuel}</span>
                    <span>📏 ${car.trim}</span>
                </div>
                <button class="car-card-button" ${car.availability === 'unavailable' ? 'disabled' : ''} onclick="viewCarFromListing(${car.id})">
                    ${car.availability === 'unavailable' ? 'Not Available' : 'View Details'}
                </button>
            </div>
        `;
        
        carsGrid.appendChild(carCard);
    });
}

// View car from listing page
function viewCarFromListing(carId) {
    navigateToCarDetail(carId);
}

// Initialize the slideshow
function initSlideshow() {
    const slidesWrapper = document.getElementById('slidesWrapper');
    const dotsContainer = document.getElementById('dotsContainer');
    
    if (!slidesWrapper || !dotsContainer) return;
    
    // Clear existing slides
    slidesWrapper.innerHTML = '';
    dotsContainer.innerHTML = '';
    
    if (cars.length === 0) {
        slidesWrapper.innerHTML = '<div class="slide active"><p style="text-align: center; padding: 100px; color: white;">No cars available</p></div>';
        return;
    }
    
    // Create slides
    cars.forEach((car, index) => {
        // Create slide
        const slide = document.createElement('div');
        slide.className = `slide ${index === 0 ? 'active' : ''}`;
        slide.dataset.carId = car.id;
        
        const img = document.createElement('img');
        img.src = car.image || '/images/placeholder.jpg';
        img.alt = car.name;
        img.loading = "lazy";
        img.onerror = function() { this.src = '/images/placeholder.jpg'; };
        
        const overlay = document.createElement('div');
        overlay.className = 'slide-overlay';
        overlay.innerHTML = `
            <h3>${car.name}</h3>
            <p>${car.price}</p>
        `;
        
        slide.appendChild(img);
        slide.appendChild(overlay);
        
        // Add click event to navigate to detail page
        slide.addEventListener('click', () => navigateToCarDetail(car.id));
        
        slidesWrapper.appendChild(slide);
        
        // Create dot
        const dot = document.createElement('span');
        dot.className = `dot ${index === 0 ? 'active' : ''}`;
        dot.addEventListener('click', () => goToSlide(index));
        dotsContainer.appendChild(dot);
    });
    
    // Show first car details by default
    if (cars.length > 0) {
        showCarDetails(cars[0].id);
    }
    
    // Update slideshow display
    updateSlideshow();
}

// Show car details (on home page)
function showCarDetails(carId) {
    const car = cars.find(c => c.id === carId);
    if (!car) return;
    
    const carName = document.getElementById('carName');
    const detailsGrid = document.getElementById('detailsGrid');
    
    if (!carName || !detailsGrid) return;
    
    carName.textContent = car.name;
    
    detailsGrid.innerHTML = `
        <div class="detail-item">
            <strong>Daily Rate</strong>
            <span>${car.price}</span>
        </div>
        <div class="detail-item">
            <strong>Year</strong>
            <span>${car.year}</span>
        </div>
         <div class="detail-item" style="grid-column: 1 / -1;">
            <strong>Trim</strong>
            <span>${car.trim}</span>
        </div>
        <div class="detail-item">
            <strong>Seats</strong>
            <span>${car.seats}</span>
        </div>
        <div class="detail-item">
            <strong>Transmission</strong>
            <span>${car.transmission}</span>
        </div>
        <div class="detail-item">
            <strong>Fuel Type</strong>
            <span>${car.fuel}</span>
        </div>
        <div class="detail-item">
            <strong>Mileage</strong>
            <span>${car.mileage}</span>
        </div>
         <div class="detail-item">
            <strong>Color</strong>
            <span>${car.color}</span>
        </div>
        <div class="detail-item" style="grid-column: 1 / -1;">
            <strong>Features</strong>
            <span>${car.features}</span>
        </div>
        <button class="rent-button" onclick="navigateToCarDetail(${car.id})">View Details & Book</button>
    `;
    
    // Don't auto-scroll - let user scroll manually if they want to see details
    // Removed auto-scroll to prevent page jumping when slides change
}

// Navigate to car detail page
function navigateToCarDetail(carId) {
    navigateTo('carDetail', carId);
}

// Render car detail page
async function renderCarDetailPage(carId) {
    try {
        // Fetch latest car data from API
        const response = await fetch(`${API_BASE_URL}/cars/${carId}`);
        if (!response.ok) throw new Error('Failed to load car details');
        const car = await response.json();
        
        // Update local cars array
        const carIndex = cars.findIndex(c => c.id === carId);
        if (carIndex !== -1) {
            cars[carIndex] = car;
        }
        
        currentCarDetailId = carId;
        currentGalleryImage = 0;
        
        const carImages = car.images && car.images.length > 0 ? car.images : [car.image || '/images/placeholder.jpg'];
        
        // Set main image
        const mainImage = document.getElementById('mainCarImage');
        if (mainImage) {
            mainImage.src = carImages[0];
            mainImage.alt = car.name;
            mainImage.onerror = function() { this.src = '/images/placeholder.jpg'; };
        }
        
        // Render thumbnails
        const thumbnailContainer = document.getElementById('thumbnailContainer');
        if (thumbnailContainer) {
            thumbnailContainer.innerHTML = '';
            carImages.forEach((img, index) => {
                const thumbnail = document.createElement('img');
                thumbnail.src = img;
                thumbnail.alt = `${car.name} - Image ${index + 1}`;
                thumbnail.className = `thumbnail ${index === 0 ? 'active' : ''}`;
                thumbnail.addEventListener('click', () => changeGalleryImage(index));
                thumbnail.onerror = function() { this.src = '/images/placeholder.jpg'; };
                thumbnailContainer.appendChild(thumbnail);
            });
        }
        
        // Set car name
        const detailCarName = document.getElementById('detailCarName');
        if (detailCarName) {
            detailCarName.textContent = car.name;
        }
        
        // Set booking price
        const bookingPrice = document.getElementById('bookingPrice');
        if (bookingPrice) {
            bookingPrice.textContent = car.price;
        }
        
        // Render car specs
        const detailSpecsGrid = document.getElementById('detailSpecsGrid');
        if (detailSpecsGrid) {
            detailSpecsGrid.innerHTML = `
                <div class="spec-item">
                    <strong>Daily Rate</strong>
                    <span>${car.price}</span>
                </div>
                <div class="spec-item">
                    <strong>Year</strong>
                    <span>${car.year}</span>
                </div>
                <div class="spec-item">
                    <strong>Seats</strong>
                    <span>${car.seats}</span>
                </div>
                <div class="spec-item">
                    <strong>Transmission</strong>
                    <span>${car.transmission}</span>
                </div>
                <div class="spec-item">
                    <strong>Fuel Type</strong>
                    <span>${car.fuel}</span>
                </div>
                <div class="spec-item">
                    <strong>Mileage</strong>
                    <span>${car.mileage}</span>
                </div>
                <div class="spec-item full-width">
                    <strong>Features</strong>
                    <span>${car.features}</span>
                </div>
            `;
        }
        
        // Set minimum date to today
        const today = new Date().toISOString().split('T')[0];
        const pickupDate = document.getElementById('pickupDate');
        const returnDate = document.getElementById('returnDate');
        if (pickupDate) {
            pickupDate.min = today;
            pickupDate.addEventListener('change', function() {
                if (returnDate) {
                    returnDate.min = this.value;
                }
                // Initialize payment when both dates are selected
                if (pickupDate.value && returnDate.value) {
                    initializePaymentForm(car.id, pickupDate.value, returnDate.value);
                }
            });
        }
        if (returnDate) {
            returnDate.min = today;
            returnDate.addEventListener('change', function() {
                // Initialize payment when both dates are selected
                if (pickupDate && pickupDate.value && returnDate.value) {
                    initializePaymentForm(car.id, pickupDate.value, returnDate.value);
                }
            });
        }
        
        // Disable booking if unavailable
        const bookingSubmitBtn = document.getElementById('bookingSubmitBtn');
        if (bookingSubmitBtn) {
            if (car.availability === 'unavailable') {
                bookingSubmitBtn.disabled = true;
                bookingSubmitBtn.textContent = 'Not Available for Booking';
                bookingSubmitBtn.style.background = '#ccc';
            } else {
                bookingSubmitBtn.disabled = false;
                bookingSubmitBtn.textContent = 'Complete Booking';
                bookingSubmitBtn.style.background = '';
            }
        }
    } catch (error) {
        console.error('Error loading car details:', error);
        alert('Failed to load car details. Please try again.');
    }
}

// Change gallery image
function changeGalleryImage(index) {
    const car = cars.find(c => c.id === currentCarDetailId);
    if (!car) return;
    
    const carImages = car.images && car.images.length > 0 ? car.images : [car.image || '/images/placeholder.jpg'];
    if (index < 0 || index >= carImages.length) return;
    
    currentGalleryImage = index;
    
    const mainImage = document.getElementById('mainCarImage');
    if (mainImage) {
        mainImage.src = carImages[index];
    }
    
    // Update active thumbnail
    const thumbnails = document.querySelectorAll('.thumbnail');
    thumbnails.forEach((thumb, i) => {
        thumb.classList.toggle('active', i === index);
    });
}

// Gallery navigation
function nextGalleryImage() {
    const car = cars.find(c => c.id === currentCarDetailId);
    if (!car) return;
    const carImages = car.images && car.images.length > 0 ? car.images : [car.image || '/images/placeholder.jpg'];
    const nextIndex = (currentGalleryImage + 1) % carImages.length;
    changeGalleryImage(nextIndex);
}

function prevGalleryImage() {
    const car = cars.find(c => c.id === currentCarDetailId);
    if (!car) return;
    const carImages = car.images && car.images.length > 0 ? car.images : [car.image || '/images/placeholder.jpg'];
    const prevIndex = (currentGalleryImage - 1 + carImages.length) % carImages.length;
    changeGalleryImage(prevIndex);
}

// Initialize Stripe payment form
async function initializePaymentForm(carId, pickupDate, returnDate) {
    try {
        if (!stripe) {
            console.warn('Stripe is not configured. Payment will be skipped.');
            return;
        }

        // Create payment intent
        const response = await fetch(`${API_BASE_URL}/create-payment-intent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                carId,
                pickupDate,
                returnDate
            })
        });

        const data = await response.json();
        
        if (!response.ok) {
            // If Stripe is not configured on server, allow booking without payment
            if (data.error && data.error.includes('Stripe is not configured')) {
                console.warn('Stripe not configured on server. Booking will proceed without payment.');
                return;
            }
            throw new Error(data.error || 'Failed to initialize payment');
        }

        paymentIntentClientSecret = data.clientSecret;
        
        // Extract payment intent ID from client secret
        const parts = paymentIntentClientSecret.split('_secret_');
        if (parts.length > 0) {
            currentPaymentIntentId = parts[0].replace('pi_', 'pi_');
        }

        // Initialize Stripe Elements
        if (!elements) {
            elements = stripe.elements();
        }

        // Create card element
        if (cardElement) {
            cardElement.unmount();
        }
        
        cardElement = elements.create('card', {
            style: {
                base: {
                    fontSize: '16px',
                    color: '#32325d',
                    '::placeholder': {
                        color: '#aab7c4',
                    },
                },
                invalid: {
                    color: '#fa755a',
                },
            },
        });

        cardElement.mount('#cardElement');
        
        // Handle real-time validation errors
        cardElement.on('change', ({error}) => {
            const displayError = document.getElementById('cardErrors');
            if (error) {
                displayError.textContent = error.message;
            } else {
                displayError.textContent = '';
            }
        });

        // Show payment section with animation
        const paymentSection = document.getElementById('paymentSection');
        if (paymentSection) {
            paymentSection.style.display = 'block';
            paymentSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        
    } catch (error) {
        console.error('Payment initialization error:', error);
        // Don't block booking if payment initialization fails
        console.warn('Continuing without payment form');
    }
}

// Handle booking form submission
async function handleBookingForm(event) {
    event.preventDefault();
    
    const car = cars.find(c => c.id === currentCarDetailId);
    if (!car) {
        alert('Car information not found. Please refresh the page.');
        return;
    }
    
    // Check if terms are accepted
    const termsCheckbox = document.getElementById('termsCheckbox');
    if (!termsCheckbox || !termsCheckbox.checked) {
        alert('Please read and accept the Terms and Conditions to proceed with your booking.');
        return;
    }
    
    const firstName = document.getElementById('bookingFirstName').value;
    const lastName = document.getElementById('bookingLastName').value;
    const email = document.getElementById('bookingEmail').value;
    const phone = document.getElementById('bookingPhone').value;
    const pickupDate = document.getElementById('pickupDate').value;
    const returnDate = document.getElementById('returnDate').value;
    const pickupLocation = document.getElementById('pickupLocation').value;
    const additionalInfo = document.getElementById('additionalInfo').value;
    
    // Validate dates
    if (new Date(returnDate) <= new Date(pickupDate)) {
        alert('Return date must be after pickup date.');
        return;
    }
    
    // Show loading state
    const bookingSubmitBtn = document.getElementById('bookingSubmitBtn');
    const originalText = bookingSubmitBtn.textContent;
    bookingSubmitBtn.disabled = true;
    bookingSubmitBtn.textContent = 'Processing Payment...';
    
    try {
        // Process payment first (if Stripe is configured)
        let paymentIntentId = null;
        
        if (stripe && paymentIntentClientSecret && cardElement) {
            const {error, paymentIntent} = await stripe.confirmCardPayment(paymentIntentClientSecret, {
                payment_method: {
                    card: cardElement,
                    billing_details: {
                        name: `${firstName} ${lastName}`,
                        email: email,
                        phone: phone,
                    },
                },
            });

            if (error) {
                throw new Error(error.message || 'Payment failed');
            }

            paymentIntentId = paymentIntent.id;
        }
        
        // Create booking after payment
        bookingSubmitBtn.textContent = 'Confirming Booking...';
        
        const response = await fetch(`${API_BASE_URL}/bookings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                carId: car.id,
                firstName,
                lastName,
                email,
                phone,
                pickupDate,
                returnDate,
                pickupLocation,
                additionalInfo,
                paymentIntentId
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to create booking');
        }
        
        // Reload cars to update availability
        await loadCars();
        
        // If we're still on car detail page, refresh it to show updated availability
        if (currentPage === 'carDetail' && currentCarDetailId) {
            await renderCarDetailPage(currentCarDetailId);
        }
        
        // Show success message
        alert(`✅ Booking Confirmed!\n\nBooking ID: ${data.booking.bookingId}\nCustomer: ${firstName} ${lastName}\nCar: ${data.booking.carName}\nRental Period: ${data.booking.days} day(s)\nTotal Price: $${data.booking.total.toFixed(2)}\n\n${data.message}\n\nThank you for choosing ES Dynamic Rentals!`);
        
        // Reset form
        document.getElementById('bookingForm').reset();
        document.getElementById('paymentSection').style.display = 'none';
        if (cardElement) {
            cardElement.unmount();
            cardElement = null;
        }
        paymentIntentClientSecret = null;
        currentPaymentIntentId = null;
        
        // Navigate back to home
        navigateTo('home');
    } catch (error) {
        console.error('Booking error:', error);
        alert(`Booking failed: ${error.message}\n\nPlease try again or contact us at 918-204-8691.`);
    } finally {
        bookingSubmitBtn.disabled = false;
        bookingSubmitBtn.textContent = originalText;
    }
}

// Show terms and conditions modal
function showTermsModal() {
    const modal = document.getElementById('termsModal');
    if (modal) {
        modal.style.display = 'block';
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }
}

// Close terms and conditions modal
function closeTermsModal() {
    const modal = document.getElementById('termsModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = ''; // Restore scrolling
    }
}

// Close modal when clicking outside of it
window.onclick = function(event) {
    const modal = document.getElementById('termsModal');
    if (event.target === modal) {
        closeTermsModal();
    }
}

// Navigate to specific slide
function goToSlide(index) {
    if (index < 0 || index >= cars.length) return;
    currentSlide = index;
    updateSlideshow();
    if (cars[index]) {
        showCarDetails(cars[index].id);
    }
}

// Update slideshow display
function updateSlideshow() {
    const slidesWrapper = document.getElementById('slidesWrapper');
    if (!slidesWrapper) return;
    
    const slides = slidesWrapper.querySelectorAll('.slide');
    const dots = document.querySelectorAll('.dot');
    
    // Move slides
    slidesWrapper.style.transform = `translateX(-${currentSlide * 100}%)`;
    
    // Update active states
    slides.forEach((slide, index) => {
        slide.classList.toggle('active', index === currentSlide);
    });
    
    dots.forEach((dot, index) => {
        dot.classList.toggle('active', index === currentSlide);
    });
}

// Next slide
function nextSlide() {
    if (cars.length === 0) return;
    currentSlide = (currentSlide + 1) % cars.length;
    updateSlideshow();
    if (cars[currentSlide]) {
        showCarDetails(cars[currentSlide].id);
    }
    resetAutoSlide();
}

// Previous slide
function prevSlide() {
    if (cars.length === 0) return;
    currentSlide = (currentSlide - 1 + cars.length) % cars.length;
    updateSlideshow();
    if (cars[currentSlide]) {
        showCarDetails(cars[currentSlide].id);
    }
    resetAutoSlide();
}

// Auto slide functionality
function startAutoSlide() {
    // Only start auto-slide if on home page
    if (currentPage !== 'home' || cars.length === 0) return;
    
    clearInterval(autoSlideInterval);
    autoSlideInterval = setInterval(() => {
        if (currentPage === 'home' && cars.length > 0) {
            currentSlide = (currentSlide + 1) % cars.length;
            updateSlideshow();
            if (cars[currentSlide]) {
                showCarDetails(cars[currentSlide].id);
            }
        }
    }, 5000); 
}

function resetAutoSlide() {
    clearInterval(autoSlideInterval);
    if (currentPage === 'home') {
        startAutoSlide();
    }
}

// Handle contact form submission
function handleContactForm(event) {
    event.preventDefault();
    
    const formData = {
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value,
        subject: document.getElementById('subject').value,
        message: document.getElementById('message').value
    };
    
    // Here you would typically send the data to a server
    // For now, we'll just show a success message
    alert(`Thank you for your message, ${formData.name}!\n\nWe have received your inquiry and will get back to you at ${formData.email} within 24 hours.`);
    
    // Reset form
    document.getElementById('contactForm').reset();
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Load cars from API
    loadCars();
    
    // Add event listeners to navigation buttons
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    
    if (prevBtn) {
        prevBtn.addEventListener('click', prevSlide);
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', nextSlide);
    }
    
    // Pause auto-slide on hover
    const slideshowContainer = document.querySelector('.slideshow-container');
    if (slideshowContainer) {
        slideshowContainer.addEventListener('mouseenter', () => {
            clearInterval(autoSlideInterval);
        });
        
        slideshowContainer.addEventListener('mouseleave', () => {
            startAutoSlide();
        });
    }
    
    // Handle contact form
    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', handleContactForm);
    }
    
    // Handle booking form
    const bookingForm = document.getElementById('bookingForm');
    if (bookingForm) {
        bookingForm.addEventListener('submit', handleBookingForm);
    }
    
    // Gallery navigation buttons
    const galleryPrev = document.getElementById('galleryPrev');
    const galleryNext = document.getElementById('galleryNext');
    if (galleryPrev) {
        galleryPrev.addEventListener('click', prevGalleryImage);
    }
    if (galleryNext) {
        galleryNext.addEventListener('click', nextGalleryImage);
    }
    
    // Initialize to home page
    navigateTo('home');
});

// Keyboard navigation
document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' && currentPage === 'home') {
        prevSlide();
    } else if (e.key === 'ArrowRight' && currentPage === 'home') {
        nextSlide();
    }
});
