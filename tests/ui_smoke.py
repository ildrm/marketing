"""Optional rendered UI smoke check. Requires Python Playwright and installed Chrome.

Run from the repository root: python3 tests/ui_smoke.py
The script creates and removes an isolated sandbox database.
"""
import os
import socket
import subprocess
import tempfile
import time
from datetime import datetime
from pathlib import Path
from urllib.request import urlopen
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def main():
    with tempfile.TemporaryDirectory(prefix='relay-ui-') as temp:
        port = free_port()
        base = f'http://127.0.0.1:{port}'
        env = {**os.environ, 'DB_PATH': str(Path(temp) / 'ui.sqlite'), 'PORT': str(port), 'PUBLIC_BASE_URL': base, 'DEMO_MODE': 'true'}
        server = subprocess.Popen(['node', 'apps/api/server.mjs'], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        try:
            for _ in range(50):
                try:
                    urlopen(base + '/api/health', timeout=0.2).close()
                    break
                except Exception:
                    time.sleep(0.1)
            else:
                raise RuntimeError('Server did not start')
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True, executable_path=CHROME, args=['--no-sandbox'])
                page = browser.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1)
                page.goto(base, wait_until='networkidle')

                def login(name):
                    page.get_by_role('button', name=name).click()
                    page.get_by_role('heading', name='Plan and prove every placement').wait_for()

                def logout():
                    page.get_by_role('button', name='Sign out').click()
                    page.get_by_role('heading', name='Every placement, accounted for.').wait_for()

                login('Ava Chen')
                page.locator('button[data-view="messaging"]').first.click()
                page.get_by_role('button', name='Record permission').click()
                page.get_by_role('dialog').get_by_role('button', name='Continue').click()
                page.get_by_text('active', exact=True).first.wait_for()
                daytime_zone = next(zone for zone in ['UTC', 'Asia/Tokyo', 'Europe/London', 'America/Los_Angeles', 'Pacific/Auckland'] if 9 <= datetime.now(ZoneInfo(zone)).hour < 21)
                page.get_by_role('button', name='Preflight SMS').click()
                page.locator('input[name="timeZone"]').fill(daytime_zone)
                page.get_by_role('dialog').get_by_role('button', name='Continue').click()
                page.locator('.notice').filter(has_text='SMS').wait_for()
                page.get_by_role('button', name='Record test send').click()
                page.locator('input[name="timeZone"]').fill(daytime_zone)
                page.get_by_role('dialog').get_by_role('button', name='Continue').click()
                page.locator('.notice').filter(has_text='Sandbox message accepted').wait_for()
                page.screenshot(path=str(ROOT / 'docs/qa/messaging-render.png'), full_page=True)
                page.locator('button[data-view="overview"]').first.click()
                page.get_by_role('button', name='Create campaign').click()
                page.locator('input[name="name"]').fill('Autumn book launch')
                page.locator('input[name="budgetMinor"]').fill('30000')
                page.locator('input[name="destination"]').fill('https://example.com/book')
                page.get_by_role('dialog').get_by_role('button', name='Continue').click()
                page.get_by_text('Autumn book launch').first.wait_for()
                page.get_by_role('button', name='Submit for review').click()
                logout()

                login('Sam Reed')
                page.locator('button[data-view="operations"]').first.click()
                page.get_by_role('button', name='Approve', exact=True).click()
                logout()

                login('Ava Chen')
                page.locator('button[data-view="marketplace"]').first.click()
                page.get_by_role('button', name='Book placement').click()
                page.get_by_role('dialog').get_by_role('button', name='Continue').click()
                page.get_by_text('Saved in sandbox').wait_for()
                logout()

                login('Mina Darvish')
                page.locator('button[data-view="journeys"]').first.click()
                page.get_by_role('button', name='Accept').click()
                page.get_by_role('button', name='Add proof').click()
                page.locator('input[name="proofUrl"]').fill('https://example.com/proof')
                page.get_by_role('dialog').get_by_role('button', name='Continue').click()
                page.get_by_role('link', name='Tracked link').wait_for()
                logout()

                login('Ava Chen')
                page.locator('button[data-view="journeys"]').first.click()
                page.get_by_role('button', name='Add conversion').click()
                page.locator('select[name="stage"]').select_option('qualified')
                page.get_by_role('dialog').get_by_role('button', name='Continue').click()
                page.locator('button[data-view="reports"]').first.click()
                assert page.locator('tbody tr td').last.inner_text() == '1'
                logout()

                login('Sam Reed')
                page.locator('button[data-view="operations"]').first.click()
                page.get_by_role('button', name='Settle').click()
                page.get_by_text('settled', exact=True).first.wait_for()
                page.get_by_text('0 discrepancies').wait_for()
                page.screenshot(path=str(ROOT / 'docs/qa/operations-render.png'), full_page=True)
                logout()

                login('Ava Chen')
                page.locator('#global-search').fill('no matching campaign')
                page.get_by_text('No matching campaigns.').wait_for()
                page.locator('#global-search').fill('Autumn')
                page.get_by_text('Autumn book launch').first.wait_for()
                page.locator('#global-search').fill('')
                page.locator('#global-search').evaluate('(element) => element.blur()')
                page.screenshot(path=str(ROOT / 'docs/qa/dashboard-render.png'), full_page=True)
                page.set_viewport_size({'width': 390, 'height': 844})
                page.screenshot(path=str(ROOT / 'docs/qa/mobile-render.png'), full_page=True)
                assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
                page.locator('button[data-action="locale"]').click()
                page.screenshot(path=str(ROOT / 'docs/qa/rtl-render.png'), full_page=True)
                assert page.locator('html').get_attribute('dir') == 'rtl'
                print('PASS: SMS permission → preflight → sandbox acceptance and advertiser → operator → owner → advertiser → operator booking journey')
                print('PASS: desktop, mobile overflow, and RTL render')
                browser.close()
        finally:
            server.terminate()
            server.wait(timeout=5)


if __name__ == '__main__':
    main()
