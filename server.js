const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const LOGIN_URL = 'https://students.rajalakshmi.org/';

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Student Portal Scraper API</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background-color: #f4f4f4;
          color: #333;
          padding: 40px;
          text-align: center;
        }
        h1 {
          color: #007bff;
        }
        p {
          font-size: 18px;
          margin: 10px 0;
        }
        .footer {
          color: red;
          font-weight: bold;
          margin-top: 50px;
        }
        .note {
          background-color: #e0f7fa;
          display: inline-block;
          padding: 15px 25px;
          border-radius: 8px;
          margin-top: 20px;
        }
      </style>
    </head>
    <body>
      <h1>Welcome to the Student Portal Scraper API</h1>
      <div class="note">
        <p>Use <code>/s/email/password</code> to scrape data.</p>
        <p>Happy Hacking!</p>
      </div>
      <p class="footer">BY:- Audi14</p>
    </body>
    </html>
  `);
});



// Scraper route: Accepts dynamic email and password from URL
app.get('/s/:email/:password', async (req, res) => {
  const { email, password } = req.params;

  let browser, context, page;

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();

    await page.goto(LOGIN_URL);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');

    const timetable = await scrapeTimetable(page);
    const notifications = await scrapeNotifications(page);

    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      timetable,
      notifications
    };

    fs.writeFileSync('timetable.json', JSON.stringify(timetable, null, 2));
    fs.writeFileSync('notifications.json', JSON.stringify(notifications, null, 2));

    res.json(response);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    if (browser) await browser.close();
  }
});

// Helper: Get current day from timetable page
async function getCurrentDay(page) {
  return await page.evaluate(() => {
    const dayElement = document.querySelector('h3.text-2xl.font-semibold.leading-none.tracking-tight');
    return dayElement?.innerText.replace('Classes', '').trim();
  });
}

// Helper: Extract sessions from a single day
async function extractDayData(page) {
  return await page.evaluate(() => {
    const sessions = [];
    const sessionElements = document.querySelectorAll('.rounded-lg.border.bg-card');

    sessionElements.forEach(session => {
      const courseCodeElement = session.querySelector('h3.font-semibold.text-lg');
      const teacherElement = session.querySelector('p.text-xs.text-muted-foreground');
      const timeElement = session.querySelector('p.font-normal.text-xs.text-foreground');
      const durationElement = session.querySelector('p.text-xs.text-muted-foreground:has(+ div)');
      const locationElement = session.querySelector('p.font-medium.text-sm.text-foreground');
      const locationTypeElement = session.querySelector('p.text-xs.text-muted-foreground:last-child');
      const typeElement = session.querySelector('[data-slot="badge"]');

      sessions.push({
        courseCode: courseCodeElement?.innerText.trim(),
        teacher: teacherElement?.innerText.trim(),
        time: timeElement?.innerText.trim(),
        duration: durationElement?.innerText.trim(),
        location: locationElement?.innerText.trim(),
        locationType: locationTypeElement?.innerText.trim(),
        type: typeElement?.innerText.trim()
      });
    });

    return sessions;
  });
}

// Helper: Click "Next Day" button in timetable view
async function clickNextDay(page) {
  const nextButton = page.locator('button:has(.lucide-chevron-right)');
  if (await nextButton.count() > 0) {
    await nextButton.click();
    await page.waitForTimeout(1000);
    return true;
  }
  return false;
}

// Scrape timetable logic
async function scrapeTimetable(page) {
  await page.goto('https://students.rajalakshmi.org/timetable');
  await page.waitForLoadState('networkidle');

  const listViewButton = page.locator('button:has-text("List View")');
  if (await listViewButton.count() > 0) {
    await listViewButton.click();
    await page.waitForTimeout(2000);
  }

  const weeklyTimetable = {};
  let currentDay = await getCurrentDay(page);
  const processedDays = new Set();

  while (currentDay && !processedDays.has(currentDay)) {
    processedDays.add(currentDay);
    weeklyTimetable[currentDay] = await extractDayData(page);

    const hasNext = await clickNextDay(page);
    if (!hasNext) break;

    currentDay = await getCurrentDay(page);
  }

  return weeklyTimetable;
}

// Scrape dashboard notifications
async function scrapeNotifications(page) {
  await page.goto('https://students.rajalakshmi.org/dashboard');
  await page.waitForLoadState('networkidle');

  return await page.evaluate(() => {
    const notifications = [];
    const notificationElements = document.querySelectorAll('.rounded-lg.text-card-foreground.overflow-hidden.border.bg-card');

    notificationElements.forEach(notification => {
      const titleElement = notification.querySelector('.font-medium.flex.items-center.gap-2');
      const dateElement = notification.querySelector('[data-slot="badge"]');
      const contentElement = notification.querySelector('.text-sm.text-muted-foreground.mt-2');

      notifications.push({
        title: titleElement?.innerText.replace('Mark as read', '').trim() || '',
        date: dateElement?.innerText.trim() || '',
        content: contentElement?.innerText.trim() || ''
      });
    });

    return notifications;
  });
}

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
