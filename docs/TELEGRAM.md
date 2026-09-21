# Notifikasi Telegram — panduan setup

Ada dua grup, satu bot:

| Grup | Parameter SSM | Isinya |
|---|---|---|
| Formulir masuk | `/jgs/prod/telegram-chat-id` | Satu pesan per formulir penyewa yang masuk dari situs |
| Jadwal rental | `/jgs/prod/telegram-rental-chat-id` | Jadwal baru, pembayaran diterima, pengingat H-1 keluar/kembali, pembayaran lewat jatuh tempo |

Bagian 1–5 memasang bot dan grup formulir. Bagian **6** memasang grup jadwal
rental — kalau bot sudah ada, langsung ke sana. Ikuti langkah di bawah **sekali
saja**; setelah itu tidak perlu deploy ulang apa pun.

Anda butuh: aplikasi Telegram, dan akses AWS CLI ke akun `121205961560`
(region `ap-southeast-1`).

---

## 1. Buat bot lewat @BotFather

1. Buka Telegram, cari **@BotFather** (centang biru), tekan **Start**.
2. Kirim `/newbot`.
3. BotFather menanyakan **nama tampilan** bot — bebas, misalnya
   `JGS Notifikasi`.
4. Lalu menanyakan **username** bot — harus unik di seluruh Telegram dan
   **wajib berakhiran `bot`**, misalnya `jgs_notifikasi_bot`.
5. BotFather membalas dengan token seperti:

   ```
   8123456789:AAHk3l-XyZ01abcdefGHIJKLmnopQRSTuvw
   ```

   **Token ini adalah kata sandi bot Anda.** Jangan kirim ke grup, jangan
   tempel di chat, jangan commit ke Git. Kalau terlanjur bocor, kirim
   `/revoke` ke BotFather untuk menggantinya.

---

## 2. Buat grup dan masukkan bot

1. Di Telegram: **New Group** → beri nama, misalnya `JGS — Formulir Masuk`.
2. Tambahkan anggota tim yang perlu menerima notifikasi.
3. Tambahkan bot Anda ke grup itu (cari dengan username dari langkah 1.4).
4. **Penting:** secara bawaan bot tidak bisa membaca pesan grup, sehingga
   langkah 3 di bawah tidak akan menemukan apa pun. Matikan privacy mode:
   kirim `/setprivacy` ke @BotFather → pilih bot Anda → **Disable**.

   > Kalau tidak ingin mematikan privacy mode, alternatifnya: jadikan bot
   > sebagai **admin grup**. Admin selalu menerima seluruh update.

---

## 3. Cari chat id grup

Telegram tidak menampilkan id grup di mana pun, jadi cara resminya adalah
membaca antrean update bot.

1. **Kirim satu pesan apa saja di grup itu** (misalnya `halo`). Tanpa ini
   antreannya kosong.
2. Jalankan, dari folder repo ini:

   ```bash
   TELEGRAM_BOT_TOKEN=<token-dari-langkah-1> npm run telegram:chat-id
   ```

   Hasilnya kira-kira:

   ```
   Chat yang terlihat oleh bot:

     -1002345678901  supergroup  JGS — Formulir Masuk
   ```

3. Salin angkanya, **termasuk tanda minus**. Id grup selalu negatif — itu
   normal, bukan kesalahan ketik.

> Antrean update hanya disimpan Telegram selama 24 jam. Kalau hasilnya kosong,
> kirim pesan baru di grup lalu ulangi.

---

## 4. Simpan token dan chat id di AWS

Keduanya disimpan di AWS Systems Manager Parameter Store, bukan di kode dan
bukan di konfigurasi Lambda — supaya bisa diganti tanpa deploy ulang.

```bash
aws ssm put-parameter \
  --name /jgs/prod/telegram-bot-token \
  --value "<token-dari-langkah-1>" \
  --type SecureString --overwrite \
  --region ap-southeast-1

aws ssm put-parameter \
  --name /jgs/prod/telegram-chat-id \
  --value "<chat-id-dari-langkah-3>" \
  --type String --overwrite \
  --region ap-southeast-1
```

Perubahan berlaku untuk eksekusi Lambda berikutnya yang dingin — paling lama
beberapa menit. Untuk memaksa langsung, ubah satu variabel environment Lambda
apa pun lewat konsol (itu memulai container baru).

---

## 5. Uji

Isi formulir di <https://jgs-ev.com/formulir> dengan data percobaan. Dalam
beberapa detik grup Anda akan menerima:

```
🚗 Formulir Penyewa Baru
JGS-260917-4KQ2

👤 Budi Santoso
📱 628118030900
✉️ budi@example.com

🚙 BYD Seal · Lepas kunci
📅 2026-09-20 09:00 WIB · 3 hari
📍 Jakarta – Bandung
🎯 Perjalanan keluarga
📎 5 dokumen terlampir

Buka di konsol admin
```

Hapus data percobaan itu dari konsol admin setelah selesai (menu **Pengajuan**
→ buka → **Hapus**; hanya Pemilik yang bisa).

---

## Kalau pesan tidak datang

Notifikasi Telegram sengaja dibuat **tidak pernah menggagalkan** pengiriman
formulir: kalau Telegram bermasalah, data penyewa tetap tersimpan dan tetap
muncul di konsol admin. Jadi periksa log, bukan formulirnya.

```bash
aws logs tail /aws/lambda/jgs-api --since 15m --region ap-southeast-1 \
  --filter-pattern telegram
```

| Yang muncul di log | Artinya | Perbaikan |
|---|---|---|
| `telegram_not_configured` | Parameter masih berisi `unset` | Ulangi langkah 4 |
| `telegram_send_failed` + `chat not found` | Chat id salah, atau bot dikeluarkan dari grup | Ulangi langkah 2 dan 3 |
| `telegram_send_failed` + `Unauthorized` | Token salah atau sudah di-`/revoke` | Ulangi langkah 1 dan 4 |
| `telegram_send_failed` + `bot was kicked` | Bot dikeluarkan dari grup | Tambahkan lagi ke grup |
| tidak ada baris sama sekali | Formulirnya sendiri tidak sampai | Cek log tanpa filter |

## Mengganti grup

Ulangi langkah 2–4 dengan grup baru. Tidak perlu membuat bot baru, dan tidak
perlu deploy ulang.

---

## 6. Grup kedua: jadwal rental

Bot yang sama mengirim ke grup yang berbeda — yang membedakan hanya chat id.
Grup ini untuk petugas yang menyiapkan mobil dan menagih pembayaran, jadi
isinya sengaja dipisah dari grup formulir.

1. Di Telegram: **New Group** → beri nama, misalnya `JGS — Jadwal Rental`.
   Masukkan petugas yang perlu tahu, lalu tambahkan bot `@jgs_notifikasi_bot`
   ke grup itu (privacy mode sudah dimatikan di langkah 2, jadi tidak perlu
   diulang).
2. **Kirim satu pesan apa saja** di grup baru itu, lalu jalankan dari folder
   repo ini:

   ```bash
   TELEGRAM_BOT_TOKEN=<token-bot> npm run telegram:chat-id
   ```

   Grup baru muncul di daftar bersama grup lama. Salin id grup **jadwal**
   (angka negatif).
3. Simpan ke parameter yang **berbeda** dari grup formulir:

   ```bash
   aws ssm put-parameter \
     --name /jgs/prod/telegram-rental-chat-id \
     --value "<chat-id-grup-jadwal>" \
     --type String --overwrite \
     --region ap-southeast-1
   ```

4. Paksa Lambda membaca ulang parameternya (nilai di-cache per container):

   ```bash
   aws lambda update-function-configuration --function-name jgs-api \
     --description "rental telegram $(date +%F)" --region ap-southeast-1
   aws lambda update-function-configuration --function-name jgs-rental-reminders \
     --description "rental telegram $(date +%F)" --region ap-southeast-1
   ```

5. Uji: buka konsol admin → **Jadwal Rental** → **Tambah jadwal**, isi data
   percobaan, simpan. Grup jadwal menerima `🆕 Jadwal Rental Baru` dalam
   beberapa detik. Ubah statusnya menjadi *Sudah Dibayar* → grup menerima
   `✅ Pembayaran Diterima`. Hapus data percobaan itu setelah selesai.

### Apa yang dikirim, dan kapan

| Pesan | Pemicu |
|---|---|
| `🆕 Jadwal Rental Baru` | Saat jadwal disimpan di konsol, apa pun status bayarnya |
| `✅ Pembayaran Diterima` | Saat status jadwal berubah dari *Belum* ke *Sudah Dibayar* |
| `🚗 Besok N unit keluar` | Setiap hari **08:00 WIB**, berisi semua jadwal yang mulai besok (H-1) |
| `🔁 Besok N unit kembali` | Setiap hari 08:00 WIB, berisi semua jadwal yang hari terakhirnya besok (H-1) |
| `⚠️ N pembayaran lewat jatuh tempo` | Setiap hari 08:00 WIB, selama masih ada jadwal *Belum Dibayar* yang tanggal jatuh temponya sudah lewat. Berhenti sendiri begitu ditandai lunas |

Tiga pesan harian dikirim oleh fungsi `jgs-rental-reminders` (jadwal
EventBridge `jgs-rental-reminders-daily`). Kalau hari itu tidak ada apa-apa,
tidak ada pesan. Setiap jadwal mencatat tanggal pengingatnya terkirim, jadi
menjalankan fungsi dua kali di hari yang sama tidak mengirim ulang:

```bash
# Menjalankan digest hari ini secara manual (aman diulang)
aws lambda invoke --function-name jgs-rental-reminders \
  --region ap-southeast-1 /dev/stdout
```

Jadwal yang dibuat **setelah** pukul 08:00 untuk esok hari tidak mendapat
pengingat H-1 lagi — pesan `🆕 Jadwal Rental Baru` yang baru saja terkirim
sudah menyebut tanggalnya.

### Kalau pesan jadwal tidak datang

Cara periksanya sama seperti tabel di atas, dengan log fungsi yang sesuai:

```bash
aws logs tail /aws/lambda/jgs-api --since 15m --region ap-southeast-1 \
  --filter-pattern telegram
aws logs tail /aws/lambda/jgs-rental-reminders --since 1d --region ap-southeast-1
```

Baris `telegram_not_configured` dengan `"audience":"rentals"` berarti
parameter `/jgs/prod/telegram-rental-chat-id` masih `unset` — ulangi langkah
6.3 dan 6.4. Baris `rental_reminders_sent` menunjukkan berapa jadwal yang
masuk tiap digest (`pickups`, `returns`, `overdue`).
