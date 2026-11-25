# Arkan Konter v2 — Aplikasi Kasir & Pembukuan Top Up E-Wallet (100% Offline)

## Fitur Utama
- **100% Full Offline**: Tanpa CDN eksternal, menggunakan Vanilla CSS, SVG inline, IndexedDB, dan Service Worker.
- **Tombol Pintas `000`**: Ketik angka singkat (misal `10`) lalu tekan `000` untuk langsung mengubah nominal menjadi `10.000`.
- **Skema Biaya Admin Berjenjang Otomatis**:
  - `< Rp 20.000` → `Rp 3.000`
  - `Rp 20.000 – Rp 120.000` → `Rp 5.000`
  - `Rp 120.001 – Rp 299.999` → `Rp 10.000`
  - `>= Rp 300.000` → `Rp 15.000`
- **Logika Kasbon Terakumulasi (1 Orang = 1 Utang)**: Pelanggan dengan nama sama otomatis digabungkan ke dalam satu catatan utang aktif.
- **Fitur Bayar / Cicil**: Mendukung pembayaran cicilan bertahap (misal utang Rp 100.000 dibayar Rp 40.000 → sisa Rp 60.000) lengkap dengan riwayat cicilan dan status **Lunas** otomatis.
- **Edit & Hapus Transaksi / Dompet**: Dilengkapi konfirmasi aman dan penyesuaian saldo otomatis.

## Cara Menggunakan
1. Ekstrak file `.zip` ini.
2. Unggah seluruh isi folder ke repositori GitHub Pages Anda (`arkan-konter`) untuk menimpa versi lama, atau jalankan lewat server lokal.
3. Buka di Chrome HP, tunggu indikator **Offline Ready**, lalu pilih **Instal aplikasi** (*Install app*).
