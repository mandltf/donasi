const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const { uploadBufferToStorage } = require('../utils/storage');
const { logStorageUpload } = require('../utils/firestore');

const getAll = asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT * FROM panti ORDER BY created_at DESC');
  return sendSuccess(res, 'Data panti berhasil dimuat.', result.rows);
});

const getById = asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT * FROM panti WHERE id = $1', [req.params.id]);
  if (result.rowCount === 0) {
    return res.status(404).json({ message: 'Panti tidak ditemukan.' });
  }
  return sendSuccess(res, 'Detail panti berhasil dimuat.', result.rows[0]);
});

const createOne = asyncHandler(async (req, res) => {
  const { nama_panti, alamat, no_telepon, email_panti, deskripsi } = req.body;
  if (!nama_panti) {
    return res.status(400).json({ message: 'Nama panti wajib diisi.' });
  }

  let foto_panti_url = null;
  let uploadedFoto = null;
  if (req.file) {
    uploadedFoto = await uploadBufferToStorage(req.file, 'foto-panti');
    foto_panti_url = uploadedFoto?.url || null;
  }

  const result = await pool.query(
    `INSERT INTO panti (nama_panti, alamat, no_telepon, email_panti, foto_panti_url, deskripsi)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [nama_panti, alamat || null, no_telepon || null, email_panti || null, foto_panti_url, deskripsi || null]
  );

  if (uploadedFoto) {
    await logStorageUpload({
      table_name: 'panti',
      record_id: result.rows[0].id,
      entity_type: 'panti',
      field_name: 'foto_panti_url',
      folder: uploadedFoto.folder,
      bucket_name: uploadedFoto.bucketName,
      object_path: uploadedFoto.path,
      url: uploadedFoto.url,
      original_name: uploadedFoto.originalName,
      file_name: uploadedFoto.fileName,
      mime_type: uploadedFoto.mimeType,
      file_size: uploadedFoto.size
    });
  }

  return sendSuccess(res, 'Panti berhasil ditambahkan.', result.rows[0], 201);
});

const updateOne = asyncHandler(async (req, res) => {
  const { nama_panti, alamat, no_telepon, email_panti } = req.body;
  const result = await pool.query(
    `UPDATE panti
     SET nama_panti = COALESCE($1, nama_panti),
         alamat = COALESCE($2, alamat),
         no_telepon = COALESCE($3, no_telepon),
         email_panti = COALESCE($4, email_panti)
     WHERE id = $5
     RETURNING *`,
    [nama_panti || null, alamat || null, no_telepon || null, email_panti || null, req.params.id]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ message: 'Panti tidak ditemukan.' });
  }

  return sendSuccess(res, 'Panti berhasil diperbarui.', result.rows[0]);
});

const removeOne = asyncHandler(async (req, res) => {
  const result = await pool.query('DELETE FROM panti WHERE id = $1 RETURNING *', [req.params.id]);
  if (result.rowCount === 0) {
    return res.status(404).json({ message: 'Panti tidak ditemukan.' });
  }
  return sendSuccess(res, 'Panti berhasil dihapus.', result.rows[0]);
});

module.exports = {
  getAll,
  getById,
  createOne,
  updateOne,
  removeOne
};
