# Notifikasi Telegram — panduan setup

Setiap formulir penyewa yang masuk dikirim sebagai satu pesan ke grup Telegram
Anda. Ikuti langkah di bawah **sekali saja**; setelah itu tidak perlu deploy
ulang apa pun.

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
