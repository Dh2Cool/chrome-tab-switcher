const checkbox = document.querySelector("#all-windows");
const saved = document.querySelector("#saved");

chrome.storage.local.get("allWindows").then(({ allWindows = false }) => {
  checkbox.checked = allWindows;
});

checkbox.addEventListener("change", async () => {
  await chrome.storage.local.set({ allWindows: checkbox.checked });
  saved.textContent = "Saved.";
  setTimeout(() => { saved.textContent = ""; }, 1400);
});

document.querySelector("#shortcuts").addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});
