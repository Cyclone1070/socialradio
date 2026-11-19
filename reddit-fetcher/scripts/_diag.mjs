import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());
const browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--start-maximized'] });
const context = await browser.newContext({ viewport: null, locale: 'en-US' });
const page = await context.newPage();
await page.goto('https://www.reddit.com/r/webscraping/comments/1xys320/', { waitUntil: 'commit', timeout: 30000 });
await page.waitForTimeout(12000);
console.log(JSON.stringify({
  url: page.url(),
  title: await page.title(),
  comments: await page.locator('shreddit-comment').count(),
  tree: await page.locator('#comment-tree').count(),
  posts: await page.locator('shreddit-post').count(),
  bodyStart: (await page.locator('body').innerText()).slice(0, 300),
}, null, 2));
await page.screenshot({ path: '/tmp/headful.png', fullPage: false });
await page.waitForTimeout(3000);
await browser.close();
