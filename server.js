const express = require('express');
const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const LOGIN_URL = 'https://students.rajalakshmi.org/';
const USERNAME = '230701194@rajalakshmi.edu.in';
const PASSWORD = 'Audi@1406';

let browser;
let context;
let page;

// Initialize browser instance
async function initBrowser() {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
  page = await context.newPage();
  await login();
}

// Login function
async function login() {
  await page.goto(LOGIN_URL);
  await page.fill('input[name="email"]', USERNAME);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
}

// Function to scrape timetable
async function scrapeTimetable() {
  if (!page.url().includes('/timetable')) {
    await page.goto('https://students.rajalakshmi.org/timetable');
    await page.waitForLoadState('networkidle');
  }

  // Switch to List View
  const listViewButton = page.locator('button:has-text("List View")');
  if (await listViewButton.count() > 0) {
    await listViewButton.click();
    await page.waitForTimeout(2000);
  }

  // Extract timetable data
  const weeklyTimetable = {};
  let currentDay = await getCurrentDay();
  const processedDays = new Set();
  
  while (currentDay && !processedDays.has(currentDay)) {
    processedDays.add(currentDay);
    weeklyTimetable[currentDay] = await extractDayData();
    
    const hasNext = await clickNextDay();
    if (!hasNext) break;
    
    currentDay = await getCurrentDay();
  }

  return weeklyTimetable;
}

// Helper functions for timetable scraping
async function getCurrentDay() {
  return await page.evaluate(() => {
    const dayElement = document.querySelector('h3.text-2xl.font-semibold.leading-none.tracking-tight');
    return dayElement?.innerText.replace('Classes', '').trim();
  });
}

async function extractDayData() {
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

async function clickNextDay() {
  const nextButton = page.locator('button:has(.lucide-chevron-right)');
  if (await nextButton.count() > 0) {
    await nextButton.click();
    await page.waitForTimeout(1000);
    return true;
  }
  return false;
}

// Function to scrape notifications
async function scrapeNotifications() {
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
app.get('/', (req, res) => {
  res.send('Welcome to the Student Portal Scraper API');    });


// API Endpoint
app.get('/api/scrape', async (req, res) => {
  try {
    // Check if we need to re-login
    if (page.url().includes('/login')) {
      await login();
    }
    
    // Scrape data
    const timetable = await scrapeTimetable();
    const notifications = await scrapeNotifications();
    
    // Prepare response
    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      timetable,
      notifications
    };
    
    // Save locally for backup
    fs.writeFileSync('timetable.json', JSON.stringify(timetable, null, 2));
    fs.writeFileSync('notifications.json', JSON.stringify(notifications, null, 2));
    
    res.json(response);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Initialize and start server
initBrowser().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize browser:', err);
  process.exit(1);
});

// Cleanup on exit
process.on('SIGINT', async () => {
  if (browser) await browser.close();
  process.exit();
});