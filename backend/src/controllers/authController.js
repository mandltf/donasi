const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const { hashPassword, comparePassword } = require('../utils/password');
const { signToken } = require('../utils/jwt');
const { uploadBufferToStorage } = require('../utils/storage');
const { logStorageUpload } = require('../utils/firestore');

function buildProfile(row) {
  if (!row) {
    return null;
  }

  const isPengurus = row.role === 'pengurus';

  return {
    id: row.id,
    email: row.email,
    role: row.role,
    id_donatur: row.id_donatur,
    id_panti: null,
    nama: isPengurus ? 'Admin Peduli Panti' : (row.nama || row.email),
    no_hp: row.no_hp || null,
    alamat: isPengurus ? 'Kantor Layanan Peduli Panti' : (row.alamat || null),
    nama_panti: null,
    foto_profil_url: row.foto_profil_url || null
  };
}

const register = asyncHandler(async (req, res) => {
  const { email, password, nama, no_hp, alamat } = req.body;
  const role = 'donatur';

  if (!email || !password || !nama) {
    return res.status(400).json({ message: 'Email, password, dan nama wajib diisi.' });
  }

  const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existingUser.rowCount > 0) {
    return res.status(409).json({ message: 'Email sudah terdaftar.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const hashedPassword = await hashPassword(password);
    const donaturResult = await client.query(
      'INSERT INTO donatur (nama, email, no_hp, alamat) VALUES ($1, $2, $3, $4) RETURNING *',
      [nama, email, no_hp || null, alamat || null]
    );

    const userResult = await client.query(
      'INSERT INTO users (email, password_hash, role, id_donatur) VALUES ($1, $2, $3, $4) RETURNING *',
      [email, hashedPassword, role, donaturResult.rows[0].id]
    );

    await client.query('COMMIT');

    const token = signToken({
      userId: userResult.rows[0].id,
      email,
      role,
      idDonatur: donaturResult.rows[0].id,
      idPanti: null
    });

    return sendSuccess(res, 'Registrasi donatur berhasil.', {
      token,
      user: buildProfile({
        ...userResult.rows[0],
        nama,
        no_hp,
        alamat
      })
    }, 201);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email dan password wajib diisi.' });
  }

  const result = await pool.query(
    `SELECT
      u.*,
      d.nama,
      d.no_hp,
      d.alamat,
      d.foto_profil_url
    FROM users u
    LEFT JOIN donatur d ON d.id = u.id_donatur
    WHERE u.email = $1
    LIMIT 1`,
    [email]
  );

  const user = result.rows[0];
  if (!user) {
    return res.status(401).json({ message: 'Email atau password salah.' });
  }

  const passwordValid = await comparePassword(password, user.password_hash);
  if (!passwordValid) {
    return res.status(401).json({ message: 'Email atau password salah.' });
  }

  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    idDonatur: user.id_donatur,
    idPanti: null
  });

  return sendSuccess(res, 'Login berhasil.', {
    token,
    user: buildProfile(user)
  });
});

const me = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const result = await pool.query(
    `SELECT
      u.*,
      d.nama,
      d.no_hp,
      d.alamat,
      d.foto_profil_url
    FROM users u
    LEFT JOIN donatur d ON d.id = u.id_donatur
    WHERE u.id = $1
    LIMIT 1`,
    [userId]
  );

  const user = result.rows[0];
  if (!user) {
    return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });
  }

  return sendSuccess(res, 'Profil berhasil dimuat.', buildProfile(user));
});

const updateProfile = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const idDonatur = req.user.idDonatur;

  if (!idDonatur) {
    return res.status(403).json({ message: 'Hanya donatur yang dapat memperbarui profil.' });
  }

  const { nama, no_hp, alamat } = req.body;

  let foto_profil_url = null;
  let uploadedFoto = null;
  if (req.file) {
    uploadedFoto = await uploadBufferToStorage(req.file, 'foto-profil');
    foto_profil_url = uploadedFoto?.url || null;
  }

  // Build dynamic update — only touch foto_profil_url if a new file was uploaded
  const setClause = foto_profil_url
    ? `nama = COALESCE($1, nama), no_hp = COALESCE($2, no_hp), alamat = COALESCE($3, alamat), foto_profil_url = $4`
    : `nama = COALESCE($1, nama), no_hp = COALESCE($2, no_hp), alamat = COALESCE($3, alamat)`;

  const params = foto_profil_url
    ? [nama || null, no_hp || null, alamat || null, foto_profil_url, idDonatur]
    : [nama || null, no_hp || null, alamat || null, idDonatur];

  const idParam = foto_profil_url ? '$5' : '$4';

  const result = await pool.query(
    `UPDATE donatur SET ${setClause} WHERE id = ${idParam} RETURNING *`,
    params
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ message: 'Donatur tidak ditemukan.' });
  }

  if (uploadedFoto) {
    await logStorageUpload({
      table_name: 'users',
      record_id: userId,
      entity_type: 'profil_donatur',
      field_name: 'foto_profil_url',
      folder: uploadedFoto.folder,
      bucket_name: uploadedFoto.bucketName,
      object_path: uploadedFoto.path,
      url: uploadedFoto.url,
      original_name: uploadedFoto.originalName,
      file_name: uploadedFoto.fileName,
      mime_type: uploadedFoto.mimeType,
      file_size: uploadedFoto.size,
      uploaded_by: userId
    });
  }

  const updated = result.rows[0];
  return sendSuccess(res, 'Profil berhasil diperbarui.', {
    nama: updated.nama,
    no_hp: updated.no_hp,
    alamat: updated.alamat,
    foto_profil_url: updated.foto_profil_url
  });
});

const changePassword = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const { password_lama, password_baru } = req.body;

  if (!password_lama || !password_baru) {
    return res.status(400).json({ message: 'Password lama dan password baru wajib diisi.' });
  }

  if (password_baru.length < 6) {
    return res.status(400).json({ message: 'Password baru minimal 6 karakter.' });
  }

  const userResult = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (userResult.rowCount === 0) {
    return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });
  }

  const valid = await comparePassword(password_lama, userResult.rows[0].password_hash);
  if (!valid) {
    return res.status(401).json({ message: 'Password lama tidak sesuai.' });
  }

  const newHash = await hashPassword(password_baru);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId]);

  return sendSuccess(res, 'Password berhasil diubah.');
});

module.exports = {
  register,
  login,
  me,
  updateProfile,
  changePassword
};
