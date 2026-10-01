import asyncio
import json
from playwright.async_api import async_playwright

async def main():
    print("Launching playwright to fetch ElazigKart routes...")
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        routes_data = None

        async def on_response(res):
            nonlocal routes_data
            if "/api/wheremybus/routes" in res.url and res.status == 200:
                try:
                    routes_data = await res.json()
                    print(f"Intercepted routes response: {len(str(routes_data))} chars")
                except:
                    pass

        page.on("response", on_response)

        try:
            await page.goto("https://elazigkart.elazig.bel.tr/wheremybus", wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(5000)

            if not routes_data:
                print("Evaluating window.fetch in page...")
                routes_data = await page.evaluate("""async () => {
                    const res = await window.fetch('/api/wheremybus/routes');
                    return await res.json();
                }""")

            if routes_data:
                with open("elazig_routes.json", "w", encoding="utf-8") as f:
                    json.dump(routes_data, f, ensure_ascii=False, indent=2)
                print("Successfully saved elazig_routes.json!")
                
                # Check data format
                data_list = routes_data.get("data", {}).get("routes", []) or routes_data.get("routes", []) or (routes_data if isinstance(routes_data, list) else [])
                print(f"Total routes found: {len(data_list)}")
                for r in data_list[:15]:
                    print(f" - {r.get('routeCode')}: {r.get('shortTitle') or r.get('title')}")
            else:
                print("Could not get routes data.")
        except Exception as e:
            print(f"Error: {e}")
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
