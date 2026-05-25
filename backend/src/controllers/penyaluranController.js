const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const { uploadBufferToStorage } = require('../utils/storage');
const { logBuktiFoto, logTransparansiTimeline, logStorageUpload } = require('../utils/firestore');

const createOne = asyncHandler(async (req, res) => {
  const { id_kebutuhan, id_panti, jumlah_disalurkan, tanggal_salur, deskripsi_penggunaan, status_penyaluran } = req.body;

  if (!id_kebutuhan || !id_panti || !jumlah_disalurkan || !tanggal_salur) {
    return res.status(400).json({ message: 'Kebutuhan, panti, jumlah, dan tanggal salur wajib diisi.' });
  }

  // Find all undistributed verified donations for this kebutuhan
  const donationsResult = await pool.query(
    `SELECT dn.id, dn.nominal 
     FROM donasi dn
     LEFT JOIN penyaluran_dana pd ON pd.id_donasi = dn.id
     WHERE dn.id_kebutuhan = $1 
       AND dn.status = 'verifikasi' 
       AND pd.id IS NULL`,
    [id_kebutuhan]
  );

  if (donationsResult.rowCount === 0) {
    return res.status(400).json({ message: 'Tidak ada donasi terverifikasi yang siap disalurkan untuk kebutuhan ini.' });
  }

  let buktiUrl = null;

  const client = await pool.connect();
  const createdPenyalurans = [];
  let clientReleased = false;

  try {
    await client.query('BEGIN');

    for (const donation of donationsResult.rows) {
      const result = await client.query(
        `INSERT INTO penyaluran_dana (id_donasi, id_panti, jumlah_disalurkan, tanggal_salur, deskripsi_penggunaan, bukti_url, status_penyaluran)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [donation.id, id_panti, donation.nominal, tanggal_salur, deskripsi_penggunaan || null, buktiUrl, status_penyaluran || 'berhasil']
      );

      const penyaluran = result.rows[0];
      createdPenyalurans.push(penyaluran);
    }

    await client.query('COMMIT');
    client.release();
    clientReleased = true;

    void (async () => {
      try {
        if (req.file) {
          const uploaded = await uploadBufferToStorage(req.file, 'bukti-penyaluran');
          buktiUrl = uploaded?.url || null;

          if (buktiUrl) {
            await Promise.all(createdPenyalurans.map((penyaluran) => pool.query(
              'UPDATE penyaluran_dana SET bukti_url = $1 WHERE id = $2',
              [buktiUrl, penyaluran.id]
            )));

            await Promise.allSettled(createdPenyalurans.map((penyaluran) => logStorageUpload({
              table_name: 'penyaluran_dana',
              record_id: penyaluran.id,
              entity_type: 'bukti_penyaluran',
              field_name: 'bukti_url',
              folder: uploaded.folder,
              bucket_name: uploaded.bucketName,
              object_path: uploaded.path,
              url: uploaded.url,
              original_name: uploaded.originalName,
              file_name: uploaded.fileName,
              mime_type: uploaded.mimeType,
              file_size: uploaded.size,
              uploaded_by: req.user?.userId || null
            })));
          }
        }

        await Promise.allSettled(createdPenyalurans.map((penyaluran) => Promise.resolve().then(async () => {
          if (buktiUrl) {
            await logBuktiFoto({
              id_penyaluran: penyaluran.id,
              id_panti: Number(id_panti),
              url: buktiUrl,
              deskripsi: deskripsi_penggunaan || 'Bukti penyaluran dana',
              tipe: 'penyaluran_dana'
            });
          }

          await logTransparansiTimeline({
            id_penyaluran: penyaluran.id,
            id_donasi: Number(penyaluran.id_donasi),
            id_panti: Number(id_panti),
            jumlah_disalurkan: Number(penyaluran.jumlah_disalurkan),
            tanggal_salur,
            deskripsi_penggunaan: deskripsi_penggunaan || null,
            bukti_url: buktiUrl,
            tipe: 'penyaluran_dana'
          });
        })));
      } catch (postCommitError) {
        console.warn('Post-commit penyaluran sync failed, SQL row is already saved:', postCommitError.message || postCommitError);
      }
    })();

    return sendSuccess(res, 'Penyaluran dana berhasil dibuat.', {
      penyaluran_count: createdPenyalurans.length,
      penyalurans: createdPenyalurans,
      bukti_url: buktiUrl
    }, 201);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (!clientReleased) {
      client.release();
    }
  }
});

const getReadyCategories = asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT 
       k.id AS id_kebutuhan,
       k.nama_barang,
       k.id_panti,
       p.nama_panti,
       COALESCE(SUM(dn.nominal), 0) AS total_nominal
     FROM donasi dn
     JOIN kebutuhan_logistik k ON k.id = dn.id_kebutuhan
     JOIN panti p ON p.id = k.id_panti
     LEFT JOIN penyaluran_dana pd ON pd.id_donasi = dn.id
     WHERE dn.status = 'verifikasi'
       AND pd.id IS NULL
     GROUP BY k.id, k.nama_barang, k.id_panti, p.nama_panti
     HAVING COALESCE(SUM(dn.nominal), 0) > 0
     ORDER BY k.nama_barang ASC`
  );

  return sendSuccess(res, 'Kategori donasi siap disalurkan berhasil dimuat.', result.rows);
});

const attachBukti = asyncHandler(async (req, res) => {
  const { id_penyaluran, deskripsi } = req.body;
  if (!id_penyaluran) {
    return res.status(400).json({ message: 'ID penyaluran wajib diisi.' });
  }
  if (!req.file) {
    return res.status(400).json({ message: 'File bukti wajib diunggah.' });
  }

  const penyaluranResult = await pool.query('SELECT * FROM penyaluran_dana WHERE id = $1', [id_penyaluran]);
  if (penyaluranResult.rowCount === 0) {
    return res.status(404).json({ message: 'Data penyaluran tidak ditemukan.' });
  }

  const uploaded = await uploadBufferToStorage(req.file, 'bukti-penyaluran');
  const buktiUrl = uploaded?.url || null;

  if (buktiUrl) {
    await pool.query(
      'UPDATE penyaluran_dana SET bukti_url = $1 WHERE id = $2',
      [buktiUrl, Number(id_penyaluran)]
    );
  }

  await logStorageUpload({
    table_name: 'penyaluran_dana',
    record_id: Number(id_penyaluran),
    entity_type: 'bukti_penyaluran',
    field_name: 'bukti_url',
    folder: uploaded.folder,
    bucket_name: uploaded.bucketName,
    object_path: uploaded.path,
    url: uploaded.url,
    original_name: uploaded.originalName,
    file_name: uploaded.fileName,
    mime_type: uploaded.mimeType,
    file_size: uploaded.size,
    uploaded_by: req.user?.userId || null
  });

  await logBuktiFoto({
    id_penyaluran: Number(id_penyaluran),
    id_panti: penyaluranResult.rows[0].id_panti,
    url: buktiUrl,
    deskripsi: deskripsi || 'Bukti tambahan penyaluran dana',
    tipe: 'penyaluran_dana'
  });

  await logTransparansiTimeline({
    id_penyaluran: Number(id_penyaluran),
    id_donasi: penyaluranResult.rows[0].id_donasi,
    id_panti: penyaluranResult.rows[0].id_panti,
    jumlah_disalurkan: Number(penyaluranResult.rows[0].jumlah_disalurkan),
    tanggal_salur: penyaluranResult.rows[0].tanggal_salur,
    deskripsi_penggunaan: deskripsi || penyaluranResult.rows[0].deskripsi_penggunaan,
    bukti_url: buktiUrl,
    tipe: 'bukti_penyaluran'
  });

  return sendSuccess(res, 'Bukti penyaluran berhasil diunggah.', {
    id_penyaluran: Number(id_penyaluran),
    url: buktiUrl,
    deskripsi: deskripsi || null
  }, 201);
});

module.exports = {
  createOne,
  attachBukti,
  getReadyCategories
};
