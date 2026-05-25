const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const { uploadBufferToStorage } = require('../utils/storage');
const { logDonationNotification, logTransparansiTimeline, syncKebutuhanRealtime, logStorageUpload } = require('../utils/firestore');

const createOne = asyncHandler(async (req, res) => {
  const idDonatur = req.user.idDonatur;
  const { id_kebutuhan, jumlah_donasi, metode_bayar } = req.body;

  if (!idDonatur) {
    return res.status(403).json({ message: 'Hanya donatur yang bisa membuat donasi.' });
  }

  const jumlahDonasi = Number(jumlah_donasi);
  if (!id_kebutuhan || !jumlahDonasi || Number.isNaN(jumlahDonasi) || jumlahDonasi <= 0) {
    return res.status(400).json({ message: 'Kebutuhan dan jumlah donasi wajib diisi.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const kebutuhanResult = await client.query(
      `SELECT id, nama_barang, harga_satuan, jumlah_dibutuhkan
       FROM kebutuhan_logistik
       WHERE id = $1
       FOR UPDATE`,
      [id_kebutuhan]
    );

    if (kebutuhanResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Kebutuhan tidak ditemukan.' });
    }

    const kebutuhan = kebutuhanResult.rows[0];
    const totalTerkumpulResult = await client.query(
      `SELECT COALESCE(SUM(jumlah_donasi), 0) AS total_terkumpul
       FROM donasi
       WHERE id_kebutuhan = $1
         AND status = 'pending'`,
      [id_kebutuhan]
    );

    const totalTerkumpul = Number(totalTerkumpulResult.rows[0]?.total_terkumpul || 0);
    const sisa = Number(kebutuhan.jumlah_dibutuhkan) - totalTerkumpul;

    if (jumlahDonasi > sisa) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: sisa <= 0
          ? 'Kebutuhan sudah terpenuhi.'
          : `Jumlah pcs melebihi sisa kebutuhan. Sisa tersedia ${sisa} pcs.`,
        sisa_donasi: Math.max(sisa, 0)
      });
    }

    const nominal = Number(kebutuhan.harga_satuan) * jumlahDonasi;

    let buktiTransferUrl = null;
    let uploadedBuktiTransfer = null;
    if (req.file) {
      uploadedBuktiTransfer = await uploadBufferToStorage(req.file, 'bukti-transfer');
      buktiTransferUrl = uploadedBuktiTransfer?.url || null;
    }

    const result = await client.query(
      `INSERT INTO donasi (id_donatur, id_kebutuhan, jumlah_donasi, nominal, metode_bayar, bukti_transfer_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING *`,
      [idDonatur, id_kebutuhan, jumlahDonasi, nominal, metode_bayar || null, buktiTransferUrl]
    );

    await client.query('COMMIT');

    if (uploadedBuktiTransfer) {
      await logStorageUpload({
        table_name: 'donasi',
        record_id: result.rows[0].id,
        entity_type: 'donasi',
        field_name: 'bukti_transfer_url',
        folder: uploadedBuktiTransfer.folder,
        bucket_name: uploadedBuktiTransfer.bucketName,
        object_path: uploadedBuktiTransfer.path,
        url: uploadedBuktiTransfer.url,
        original_name: uploadedBuktiTransfer.originalName,
        file_name: uploadedBuktiTransfer.fileName,
        mime_type: uploadedBuktiTransfer.mimeType,
        file_size: uploadedBuktiTransfer.size,
        uploaded_by: idDonatur
      });
    }

    return sendSuccess(res, 'Donasi berhasil dibuat dan menunggu verifikasi.', result.rows[0], 201);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

const listPending = asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT dn.*, d.nama AS nama_donatur, k.nama_barang
     FROM donasi dn
     JOIN donatur d ON d.id = dn.id_donatur
     JOIN kebutuhan_logistik k ON k.id = dn.id_kebutuhan
     WHERE dn.status = 'pending'
     ORDER BY dn.created_at DESC`
  );

  return sendSuccess(res, 'Daftar donasi pending berhasil dimuat.', result.rows);
});

const listVerified = asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT dn.*, d.nama AS nama_donatur, k.nama_barang
     FROM donasi dn
     JOIN donatur d ON d.id = dn.id_donatur
     JOIN kebutuhan_logistik k ON k.id = dn.id_kebutuhan
     WHERE dn.status = 'verifikasi'
     ORDER BY dn.created_at DESC`
  );

  return sendSuccess(res, 'Daftar donasi verifikasi berhasil dimuat.', result.rows);
});

const listAll = asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT dn.*, d.nama AS nama_donatur, k.nama_barang, p.nama_panti
     FROM donasi dn
     JOIN donatur d ON d.id = dn.id_donatur
     JOIN kebutuhan_logistik k ON k.id = dn.id_kebutuhan
     JOIN panti p ON p.id = k.id_panti
     ORDER BY dn.created_at DESC`
  );

  return sendSuccess(res, 'Semua riwayat donasi berhasil dimuat.', result.rows);
});

const verifyOne = asyncHandler(async (req, res) => {
  const { status, alasan_ditolak } = req.body;
  const allowedStatus = ['verifikasi', 'ditolak'];

  if (!allowedStatus.includes(status)) {
    return res.status(400).json({ message: 'Status verifikasi tidak valid.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const donationCheck = await client.query('SELECT * FROM donasi WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (donationCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Donasi tidak ditemukan.' });
    }
    const oldDonation = donationCheck.rows[0];

    if (oldDonation.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Hanya donasi dengan status pending yang dapat diverifikasi.' });
    }

    const result = await client.query(
      `UPDATE donasi
       SET status = $1, alasan_ditolak = $2
       WHERE id = $3
       RETURNING *`,
      [status, status === 'ditolak' ? (alasan_ditolak || null) : null, req.params.id]
    );

    const donation = result.rows[0];

    if (status === 'verifikasi') {
      const kebutuhanUpdate = await client.query(
        `UPDATE kebutuhan_logistik
         SET 
           jumlah_dibutuhkan = GREATEST(0, jumlah_dibutuhkan - $1),
           status = CASE WHEN jumlah_dibutuhkan - $1 <= 0 THEN 'selesai' ELSE status END
         WHERE id = $2
         RETURNING *`,
        [donation.jumlah_donasi, donation.id_kebutuhan]
      );
      
      if (kebutuhanUpdate.rowCount > 0) {
        await syncKebutuhanRealtime(kebutuhanUpdate.rows[0]);
      }
    }

    await client.query('COMMIT');

    const donorInfo = await pool.query('SELECT email, nama FROM donatur WHERE id = $1', [donation.id_donatur]);
    const kebutuhanInfo = await pool.query('SELECT nama_barang FROM kebutuhan_logistik WHERE id = $1', [donation.id_kebutuhan]);

    await logDonationNotification({
      id_donatur: donation.id_donatur,
      id_donasi: donation.id,
      judul: status === 'verifikasi' ? 'Donasi diverifikasi' : 'Donasi ditolak',
      pesan: status === 'verifikasi'
        ? `Donasi untuk ${kebutuhanInfo.rows[0]?.nama_barang || 'kebutuhan'} telah diverifikasi.`
        : `Donasi untuk ${kebutuhanInfo.rows[0]?.nama_barang || 'kebutuhan'} ditolak.${alasan_ditolak ? ' Alasan: ' + alasan_ditolak : ''}`,
      status,
      email_donatur: donorInfo.rows[0]?.email || null
    });

    await logTransparansiTimeline({
      id_donasi: donation.id,
      tipe: 'verifikasi_donasi',
      status,
      nominal: Number(donation.nominal),
      id_donatur: donation.id_donatur,
      id_kebutuhan: donation.id_kebutuhan,
      judul: 'Verifikasi donasi'
    });

    return sendSuccess(res, 'Status donasi berhasil diperbarui.', donation);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

const getOne = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const result = await pool.query(
    `SELECT dn.*, d.nama AS nama_donatur, k.nama_barang
     FROM donasi dn
     JOIN donatur d ON d.id = dn.id_donatur
     JOIN kebutuhan_logistik k ON k.id = dn.id_kebutuhan
     WHERE dn.id = $1
     LIMIT 1`,
    [id]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ message: 'Donasi tidak ditemukan.' });
  }

  const donation = result.rows[0];

  // Ensure any stored URLs are signed if using private GCS
  const { getSignedUrlForStoredUrl } = require('../utils/storage');
  if (donation.bukti_transfer_url) {
    try {
      donation.bukti_transfer_signed = await getSignedUrlForStoredUrl(donation.bukti_transfer_url);
    } catch (err) {
      donation.bukti_transfer_signed = donation.bukti_transfer_url;
    }
  }

  // Also fetch any penyaluran entries (bukti_url) related to this donation
  const penyaluranRes = await pool.query(
    `SELECT id, id_panti, jumlah_disalurkan, tanggal_salur, deskripsi_penggunaan, bukti_url
     FROM penyaluran_dana
     WHERE id_donasi = $1
     ORDER BY tanggal_salur DESC`,
    [donation.id]
  );

  if (penyaluranRes.rowCount > 0) {
    donation.penyaluran = await Promise.all(penyaluranRes.rows.map(async (p) => {
      const out = { ...p };
      if (p.bukti_url) {
        try {
          out.bukti_signed = await getSignedUrlForStoredUrl(p.bukti_url);
        } catch (err) {
          out.bukti_signed = p.bukti_url;
        }
      }
      return out;
    }));
  } else {
    donation.penyaluran = [];
  }

  return sendSuccess(res, 'Detail donasi berhasil dimuat.', donation);
});

const requestRefund = asyncHandler(async (req, res) => {
  const idDonatur = req.user.idDonatur;
  const { id } = req.params;

  if (!idDonatur) {
    return res.status(403).json({ message: 'Hanya donatur yang dapat mengajukan refund.' });
  }

  // Check if donation exists and belongs to the donor
  const checkRes = await pool.query('SELECT * FROM donasi WHERE id = $1', [id]);
  if (checkRes.rowCount === 0) {
    return res.status(404).json({ message: 'Donasi tidak ditemukan.' });
  }

  const donation = checkRes.rows[0];
  if (donation.id_donatur !== idDonatur) {
    return res.status(403).json({ message: 'Akses ditolak. Donasi ini bukan milik Anda.' });
  }

  if (donation.status !== 'ditolak') {
    return res.status(400).json({ message: 'Hanya donasi dengan status Ditolak yang dapat diajukan refund.' });
  }

  // Update status to refund_diajukan
  const updateRes = await pool.query(
    `UPDATE donasi
     SET status = 'refund_diajukan'
     WHERE id = $1
     RETURNING *`,
    [id]
  );

  const updatedDonation = updateRes.rows[0];
  const donorInfo = await pool.query('SELECT email FROM donatur WHERE id = $1', [idDonatur]);
  const kebutuhanInfo = await pool.query('SELECT nama_barang FROM kebutuhan_logistik WHERE id = $1', [updatedDonation.id_kebutuhan]);

  await logDonationNotification({
    id_donatur: idDonatur,
    id_donasi: updatedDonation.id,
    judul: 'Anda berhasil ajukan refund',
    pesan: `Pengajuan refund untuk donasi ${kebutuhanInfo.rows[0]?.nama_barang || 'kebutuhan'} berhasil dikirim dan sedang diproses.`,
    status: 'refund_diajukan',
    email_donatur: donorInfo.rows[0]?.email || null
  });

  return sendSuccess(res, 'Refund berhasil diajukan.', updatedDonation);
});

module.exports = {
  createOne,
  listPending,
  listVerified,
  listAll,
  verifyOne,
  getOne,
  requestRefund
};
