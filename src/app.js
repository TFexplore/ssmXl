const express = require('express');
const path = require('path');
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // For serving static files like user page

// Use API routes
app.use('/api/admin', adminRoutes);
app.use('/', userRoutes); // User routes are at the root level for /sms-link/:token

module.exports = app;
