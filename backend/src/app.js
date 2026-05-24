const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const env = require('./config/env');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const pantiRoutes = require('./routes/pantiRoutes');
const kebutuhanRoutes = require('./routes/kebutuhanRoutes');
const donasiRoutes = require('./routes/donasiRoutes');
const donaturRoutes = require('./routes/donaturRoutes');
const penyaluranRoutes = require('./routes/penyaluranRoutes');
const ceritaRoutes = require('./routes/ceritaRoutes');
const laporanRoutes = require('./routes/laporanRoutes');

const app = express();

app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

/**
 * CORS FIX (IMPORTANT)
 * - jangan pakai "*"
 * - harus spesifik domain FE
 */
const corsOptions = {
  origin: env.corsOrigin,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
};

app.use(cors(corsOptions));

/**
 * HEALTH CHECK
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'donasi-panti-api' });
});

/**
 * ROUTES
 */
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/panti', pantiRoutes);
app.use('/kebutuhan', kebutuhanRoutes);
app.use('/donasi', donasiRoutes);
app.use('/donatur', donaturRoutes);
app.use('/penyaluran', penyaluranRoutes);
app.use('/cerita', ceritaRoutes);
app.use('/laporan', laporanRoutes);

/**
 * ERROR HANDLER
 */
app.use(notFound);
app.use(errorHandler);

module.exports = app;