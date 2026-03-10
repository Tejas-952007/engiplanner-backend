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

// ─── Direct HTTP Email Instead of SMTP ──────────────────────────────────────
const sendHttpEmail = async (to, subject, html) => {
  // We will use a public free relay or API that doesn't use SMTP
  // Render allows HTTP requests out. Since we need to send to dynamic emails securely
  // we should use a generic API or use custom EmailJS if possible.
  // However, since we own the app, we can use Brevo / Sendinblue / Resend FREE if API key provided,
  // OR just use nodemailer with another config.
  // Wait, let's try configuring nodemailer with direct transport fallback, or we can use 
  // default SMTP but force IPv4 only by adding localAddress: '0.0.0.0' or specific settings.
  // Sometimes Render blocks IPv6 SMTP.
};

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  // Force IPv4 to prevent Render IPv6 networking routing loops that cause timeouts
  localAddress: '0.0.0.0'
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

// Days until deadline (negative = overdue)
function daysUntil(deadline) {
  if (!deadline) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(deadline);
  d.setHours(0, 0, 0, 0);
  return Math.ceil((d - today) / 86400000);
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

// ─── Core: Send Morning Briefing Email ───────────────────────────────────────
async function sendMorningBriefingEmail(email, userName, allTasks) {
  const pending = allTasks.filter(t => !t.completed);
  const overdue = pending.filter(t => t.deadline && daysUntil(t.deadline) < 0);
  const dueToday = pending.filter(t => t.deadline && daysUntil(t.deadline) === 0);
  const upcoming = pending.filter(t => t.deadline && daysUntil(t.deadline) > 0 && daysUntil(t.deadline) <= 3);
  const noDeadline = pending.filter(t => !t.deadline).slice(0, 5); // show max 5 undated

  const total = pending.length;
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const buildRows = (arr, badgeColor, badgeText) =>
    arr.map(t => `
      <tr>
        <td style="padding:10px 16px; border-bottom:1px solid #1a1a2e; font-size:14px; color:#e6e6ef;">
          ${t.title}
          ${t.subject ? `<span style="font-size:11px; background:rgba(88,166,255,0.15); color:#58a6ff; padding:1px 7px; border-radius:8px; margin-left:6px;">${t.subject}</span>` : ''}
        </td>
        <td style="padding:10px 12px; border-bottom:1px solid #1a1a2e; font-size:12px; color:#888; white-space:nowrap;">${t.category || '—'}</td>
        <td style="padding:10px 12px; border-bottom:1px solid #1a1a2e; text-align:center; white-space:nowrap;">
          <span style="font-size:11px; font-weight:700; background:${badgeColor}22; color:${badgeColor}; padding:2px 8px; border-radius:99px;">${badgeText}</span>
        </td>
      </tr>`).join('');

  const section = (title, icon, arr, color, badge) =>
    arr.length === 0 ? '' : `
    <h3 style="color:${color}; margin:24px 0 8px; font-size:15px;">${icon} ${title} (${arr.length})</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; background:#0f0f1a; border-radius:10px; overflow:hidden; margin-bottom:12px;">
      <thead><tr>
        <th style="text-align:left; padding:9px 16px; font-size:11px; color:#555; background:#0a0a14;">Task</th>
        <th style="text-align:left; padding:9px 12px; font-size:11px; color:#555; background:#0a0a14;">Category</th>
        <th style="text-align:center; padding:9px 12px; font-size:11px; color:#555; background:#0a0a14;">Status</th>
      </tr></thead>
      <tbody>${buildRows(arr, color, badge)}</tbody>
    </table>`;

  const html = `
  <!DOCTYPE html>
  <html>
  <head><meta charset="UTF-8"></head>
  <body style="margin:0; padding:0; background:#070710; font-family:'Segoe UI',Arial,sans-serif;">
    <div style="max-width:620px; margin:36px auto; background:#0d0d1a; border-radius:18px; overflow:hidden; border:1px solid #1a1a2e;">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#0d0d1a 0%,#141428 100%); padding:28px 32px 22px; border-bottom:1px solid #1a1a2e;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="width:42px; height:42px; background:linear-gradient(135deg,#6e56cf,#58a6ff); border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:22px;">🎓</div>
          <div>
            <div style="font-size:20px; font-weight:800; color:#fff; letter-spacing:-0.3px;">${process.env.APP_NAME}</div>
            <div style="font-size:12px; color:#4a4a6a; margin-top:2px;">☀️ Morning Briefing — ${today}</div>
          </div>
        </div>
      </div>

      <!-- Greeting + Stats -->
      <div style="padding:28px 32px 0;">
        <h2 style="color:#fff; margin:0 0 6px; font-size:22px;">Good morning, ${userName}! 👋</h2>
        <p style="color:#6e7681; margin:0 0 22px; line-height:1.6; font-size:14px;">
          Here's your task briefing for today. You have
          <strong style="color:#fff;">${total} pending task${total !== 1 ? 's' : ''}</strong> total.
        </p>

        <!-- Quick Stats Row -->
        <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:24px;">
          ${overdue.length > 0 ? `<div style="flex:1; min-width:100px; background:#ff7b7211; border:1px solid #ff7b7233; border-radius:10px; padding:12px 16px; text-align:center;"><div style="font-size:22px; font-weight:900; color:#ff7b72;">${overdue.length}</div><div style="font-size:11px; color:#ff7b7299;">Overdue</div></div>` : ''}
          ${dueToday.length > 0 ? `<div style="flex:1; min-width:100px; background:#ffa65711; border:1px solid #ffa65733; border-radius:10px; padding:12px 16px; text-align:center;"><div style="font-size:22px; font-weight:900; color:#ffa657;">${dueToday.length}</div><div style="font-size:11px; color:#ffa65799;">Due Today</div></div>` : ''}
          ${upcoming.length > 0 ? `<div style="flex:1; min-width:100px; background:#c084fc11; border:1px solid #c084fc33; border-radius:10px; padding:12px 16px; text-align:center;"><div style="font-size:22px; font-weight:900; color:#c084fc;">${upcoming.length}</div><div style="font-size:11px; color:#c084fc99;">Upcoming (3d)</div></div>` : ''}
          <div style="flex:1; min-width:100px; background:#34d39911; border:1px solid #34d39933; border-radius:10px; padding:12px 16px; text-align:center;"><div style="font-size:22px; font-weight:900; color:#34d399;">${total}</div><div style="font-size:11px; color:#34d39999;">Total Pending</div></div>
        </div>

        ${section('Overdue', '⚠️', overdue, '#ff7b72', 'OVERDUE')}
        ${section('Due Today', '📅', dueToday, '#ffa657', 'Today')}
        ${section('Upcoming (next 3 days)', '📌', upcoming, '#c084fc', '≤3 days')}
        ${noDeadline.length > 0 ? section('No Deadline Set', '📝', noDeadline, '#6e7681', 'No Date') : ''}

        <!-- CTA -->
        <div style="margin:24px 0 28px; padding:18px; background:#12121c; border-radius:12px; border:1px solid #1e1e2e; text-align:center;">
          <p style="color:#8b949e; margin:0 0 14px; font-size:13px;">Open the app to manage your tasks 👇</p>
          <a href="https://engiplanner.vercel.app"
             style="display:inline-block; background:linear-gradient(135deg,#6e56cf,#58a6ff); color:#fff; padding:11px 26px;
                    border-radius:8px; text-decoration:none; font-weight:700; font-size:14px;">
            Open ${process.env.APP_NAME} →
          </a>
        </div>
      </div>

      <!-- Footer -->
      <div style="padding:16px 32px; border-top:1px solid #1a1a2e; text-align:center;">
        <p style="color:#2d2d4a; font-size:11px; margin:0;">
          You're receiving this because you enabled Email Reminders in ${process.env.APP_NAME}.<br>
          To stop, disable "Email Reminders" in Settings.
        </p>
      </div>
    </div>
  </body>
  </html>`;

  const pendingCount = overdue.length + dueToday.length;
  const subjectEmoji = pendingCount > 0 ? '⚠️' : '☀️';
  await transporter.sendMail({
    from: `"${process.env.APP_NAME}" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `${subjectEmoji} Morning Briefing — ${dueToday.length} due today, ${overdue.length} overdue · ${process.env.APP_NAME}`,
    html,
  });

  console.log(`☀️ Morning briefing sent to ${email}`);
}

// ─── Core: Send Morning Briefings to All Users ───────────────────────────────
async function runMorningBriefings() {
  console.log(`\n[${new Date().toISOString()}] ☀️ Running morning briefings...`);

  try {
    const snapshot = await db.collection('users').get();
    let sent = 0, skipped = 0;

    for (const userDoc of snapshot.docs) {
      const data = userDoc.data();
      const profile = data?.profile;
      const tasks = data?.tasks || [];

      if (!profile?.emailReminders) { skipped++; continue; }
      if (!profile?.email) { skipped++; continue; }

      const pending = tasks.filter(t => !t.completed);
      if (pending.length === 0) { skipped++; continue; }

      try {
        await sendMorningBriefingEmail(profile.email, profile.name || 'Student', tasks);
        sent++;
      } catch (err) {
        console.error(`❌ Failed to send briefing to ${profile.email}:`, err.message);
      }
    }

    console.log(`✅ Morning briefings done. Sent: ${sent}, Skipped: ${skipped}`);
  } catch (err) {
    console.error('❌ Error fetching users:', err.message);
  }
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

// ─── Health check endpoint (cron-job.org pings this to keep server alive) ────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', uptime: process.uptime(), time: new Date().toISOString() });
});

// Manual trigger for deadline reminder
app.post('/trigger', async (req, res) => {
  const { secret } = req.body;
  if (secret !== process.env.TRIGGER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({ message: 'Deadline reminder job started' });
  runDailyReminders();
});

// Manual trigger for morning briefing (for testing)
app.post('/trigger-briefing', async (req, res) => {
  const { secret } = req.body;
  if (secret !== process.env.TRIGGER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({ message: 'Morning briefing job started' });
  runMorningBriefings();
});

// ─── User self-triggered reminder (secure via Firebase ID token) ─────────────
// Frontend calls this with the logged-in user's ID token — no shared secret needed
app.post('/send-my-reminder', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'idToken required' });

  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });

    const data = userDoc.data();
    const profile = data?.profile || {};
    const tasks = data?.tasks || [];

    if (!profile.email) return res.status(400).json({ error: 'No email on profile' });

    res.json({ message: 'Sending your reminder now! Check your inbox in a few seconds.' });

    // Send async — don't await so response is fast
    sendMorningBriefingEmail(profile.email, profile.name || 'Student', tasks)
      .then(() => console.log(`📧 Self-triggered briefing sent to ${profile.email}`))
      .catch(e => console.error('Self-trigger email error:', e.message));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🌐 EngiPlanner Email Service running on port ${PORT}`);

  // ── CRON 1: Morning Briefing — 6:00 AM IST = 0:30 AM UTC ──────────────
  const briefingSchedule = process.env.BRIEFING_SCHEDULE || '30 0 * * *';
  cron.schedule(briefingSchedule, () => {
    runMorningBriefings();
  }, { timezone: 'UTC' });
  console.log(`☀️  Morning briefing CRON: "${briefingSchedule}" UTC = 6:00 AM IST`);

  // ── CRON 2: Deadline Reminder — 7:00 AM IST = 1:30 AM UTC ─────────────
  const schedule = process.env.CRON_SCHEDULE || '0 7 * * *';
  cron.schedule(schedule, () => {
    runDailyReminders();
  }, { timezone: 'UTC' });
  console.log(`⏰  Deadline reminder CRON: "${schedule}" UTC = 12:30 PM IST\n`);
});
