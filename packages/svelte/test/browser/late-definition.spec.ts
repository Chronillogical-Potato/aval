import { expect, test, type Locator } from "@playwright/test";

async function snapshotApi(player: Locator) {
  return player.evaluate((node) => ({
    getSnapshot: typeof Reflect.get(node, "getSnapshot"),
    subscribe: typeof Reflect.get(node, "subscribe")
  }));
}

test("attaches a host imported from a template before registration", async ({
  page
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/late-definition.html");

  await expect(page.getByTestId("imported-attach")).toHaveText("attached");
  expect(await snapshotApi(page.getByTestId("imported-player"))).toEqual({
    getSnapshot: "function",
    subscribe: "function"
  });
  expect(errors).toEqual([]);
});

test("attaches a disconnected host defined after it was imported", async ({
  page
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/disconnected-host.html");

  await expect(page.getByTestId("disconnected-attach")).toHaveText("attached");
  expect(errors).toEqual([]);
});

test("mounts AvalComponent without the page registering aval-player", async ({
  page
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/late-component.html");

  const player = page.getByTestId("player");
  await expect(player).toHaveAttribute("autoplay", "manual");
  expect(await snapshotApi(player)).toEqual({
    getSnapshot: "function",
    subscribe: "function"
  });
  await expect(page.getByTestId("controller-readiness")).not.toBeEmpty();
  expect(errors).toEqual([]);
});
