require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

// ─── Firebase Admin Init ──────────────────────────────────────────────────
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    // Render stores env vars with literal \n — convert them back
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
});

const db = admin.firestore();

// ─── Email Transporter ────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,       // Use secure port
  secure: true,    // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().split('T')[0];

function getDeadlineStatus(deadline) {
  if (!deadline) return null;
  const today = todayStr();
  if (deadline < today) return 'OVERDUE';
  if (deadline === today) return 'Due Today';
  return null; // not urgent
}

// ─── Core: Send Deadline Email ────────────────────────────────────────────
async function sendDeadlineEmail(email, userName, tasks) {
  const overdue = tasks.filter(t => getDeadlineStatus(t.deadline) === 'OVERDUE');
  const dueToday = tasks.filter(t => getDeadlineStatus(t.deadline) === 'Due Today');

  if (overdue.length === 0 && dueToday.length === 0) return; // nothing urgent

  const buildRows = (arr, color) =>
    arr
      .map(
        t => `
        <tr>
          <td style="padding:10px 16px; border-bottom:1px solid #1e1e2e; font-size:14px; color:#e6e6ef;">${t.title}</td>
          <td style="padding:10px 16px; border-bottom:1px solid #1e1e2e; font-size:13px; color:#888; white-space:nowrap;">${t.category || '—'}</td>
          <td style="padding:10px 16px; border-bottom:1px solid #1e1e2e; font-size:12px; font-weight:700; color:${color}; white-space:nowrap;">${t.deadline}</td>
        </tr>`
      )
      .join('');

  const overdueSection =
    overdue.length > 0
      ? `<h3 style="color:#ff7b72; margin:24px 0 8px;">⚠️ Overdue (${overdue.length})</h3>
         <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; background:#12121c; border-radius:10px; overflow:hidden;">
           <thead><tr>
             <th style="text-align:left; padding:10px 16px; font-size:12px; color:#555; background:#0d0d1a;">Task</th>
             <th style="text-align:left; padding:10px 16px; font-size:12px; color:#555; background:#0d0d1a;">Category</th>
             <th style="text-align:left; padding:10px 16px; font-size:12px; color:#555; background:#0d0d1a;">Deadline</th>
           </tr></thead>
           <tbody>${buildRows(overdue, '#ff7b72')}</tbody>
         </table>`
      : '';

  const todaySection =
    dueToday.length > 0
      ? `<h3 style="color:#ffa657; margin:24px 0 8px;">📅 Due Today (${dueToday.length})</h3>
         <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; background:#12121c; border-radius:10px; overflow:hidden;">
           <thead><tr>
             <th style="text-align:left; padding:10px 16px; font-size:12px; color:#555; background:#0d0d1a;">Task</th>
             <th style="text-align:left; padding:10px 16px; font-size:12px; color:#555; background:#0d0d1a;">Category</th>
             <th style="text-align:left; padding:10px 16px; font-size:12px; color:#555; background:#0d0d1a;">Deadline</th>
           </tr></thead>
           <tbody>${buildRows(dueToday, '#ffa657')}</tbody>
         </table>`
      : '';

  const html = `
  <!DOCTYPE html>
  <html>
  <head><meta charset="UTF-8"></head>
  <body style="margin:0; padding:0; background:#0a0a14; font-family:'Segoe UI',Arial,sans-serif;">
    <div style="max-width:600px; margin:40px auto; background:#0f0f1a; border-radius:16px; overflow:hidden; border:1px solid #1e1e2e;">
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%); padding:32px 32px 24px; border-bottom:1px solid #1e1e2e;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="width:40px; height:40px; background:linear-gradient(135deg,#6e56cf,#58a6ff); border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:20px;">🎓</div>
          <div>
            <div style="font-size:20px; font-weight:700; color:#fff; letter-spacing:-0.3px;">${process.env.APP_NAME}</div>
            <div style="font-size:12px; color:#6e7681; margin-top:2px;">Task Deadline Reminder</div>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div style="padding:32px;">
        <h2 style="color:#fff; margin:0 0 8px; font-size:22px;">
          Hey ${userName} 👋
        </h2>
        <p style="color:#8b949e; margin:0 0 24px; line-height:1.6;">
          Here's your daily task reminder from <strong style="color:#58a6ff;">${process.env.APP_NAME}</strong>.
          You have <strong style="color:#ff7b72;">${overdue.length} overdue</strong> and 
          <strong style="color:#ffa657;">${dueToday.length} tasks due today</strong>. Don't let the streak break! 🔥
        </p>

        ${overdueSection}
        ${todaySection}

        <div style="margin-top:32px; padding:20px; background:#12121c; border-radius:12px; border:1px solid #1e1e2e; text-align:center;">
          <p style="color:#8b949e; margin:0 0 16px; font-size:14px;">Open the app to mark tasks as done 👇</p>
          <a href="https://your-app-url.com" 
             style="display:inline-block; background:linear-gradient(135deg,#6e56cf,#58a6ff); color:#fff; padding:12px 28px; border-radius:8px; text-decoration:none; font-weight:600; font-size:15px;">
            Open ${process.env.APP_NAME} →
          </a>
        </div>
      </div>

      <!-- Footer -->
      <div style="padding:20px 32px; border-top:1px solid #1e1e2e; text-align:center;">
        <p style="color:#3d3d5c; font-size:12px; margin:0;">
          You're receiving this because you enabled deadline reminders in ${process.env.APP_NAME}.<br>
          To unsubscribe, disable "Email Reminders" in Settings.
        </p>
      </div>
    </div>
  </body>
  </html>`;

  await transporter.sendMail({
    from: `"${process.env.APP_NAME}" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `⏰ ${dueToday.length + overdue.length} Task${dueToday.length + overdue.length > 1 ? 's' : ''} need your attention — ${process.env.APP_NAME}`,
    html,
  });

  console.log(`✅ Email sent to ${email} (${overdue.length} overdue, ${dueToday.length} due today)`);
}

// ─── Core: Check All Users & Send Emails ─────────────────────────────────
async function runDailyReminders() {
  console.log(`\n[${new Date().toISOString()}] 🚀 Running daily email reminders...`);

  try {
    const snapshot = await db.collection('users').get();
    let sent = 0, skipped = 0;

    for (const userDoc of snapshot.docs) {
      const data = userDoc.data();
      const profile = data?.profile;
      const tasks = data?.tasks || [];

      // Skip if user hasn't enabled email reminders or no email
      if (!profile?.emailReminders) { skipped++; continue; }
      if (!profile?.email) { skipped++; continue; }

      // Only look at pending tasks with a deadline
      const pendingWithDeadline = tasks.filter(
        t => !t.completed && t.deadline && getDeadlineStatus(t.deadline) !== null
      );

      if (pendingWithDeadline.length === 0) { skipped++; continue; }

      try {
        await sendDeadlineEmail(profile.email, profile.name || 'Student', pendingWithDeadline);
        sent++;
      } catch (err) {
        console.error(`❌ Failed to send email to ${profile.email}:`, err.message);
      }
    }

    console.log(`✅ Done. Sent: ${sent}, Skipped: ${skipped}`);
  } catch (err) {
    console.error('❌ Error fetching users from Firestore:', err.message);
  }
}

// ─── Express App (for Render health-check) ───────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: `${process.env.APP_NAME} Email Reminder Service`, time: new Date().toISOString() });
});

// Manual trigger endpoint (useful for testing without waiting for cron)
app.post('/trigger', async (req, res) => {
  const { secret } = req.body;
  // Simple security — add TRIGGER_SECRET to your .env
  if (secret !== process.env.TRIGGER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({ message: 'Reminder job started' });
  runDailyReminders(); // run async, don't await
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🌐 EngiPlanner Email Service running on port ${PORT}`);

  // ── CRON Job — Default: 7:00 AM UTC = 12:30 PM IST every day ──────────
  const schedule = process.env.CRON_SCHEDULE || '0 7 * * *';
  cron.schedule(schedule, () => {
    runDailyReminders();
  }, { timezone: 'UTC' });

  console.log(`⏰ CRON job scheduled: "${schedule}" (UTC)`);
  console.log(`   = 12:30 PM IST every day\n`);
});
