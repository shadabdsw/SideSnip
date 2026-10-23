# SideSnip

A small frosted-glass panel that sits at the edge of your browser and holds the answers you type again and again: your LinkedIn link, notice period, a short bio, even your resume file. Click one to copy it, or drop it straight into the form you're filling.

Handy for job applications, email replies, support tickets or any form you fill in often. It works on any website.

---

## Install

Download the latest ZIP from the [releases page](https://github.com/shadabdsw/sidesnip/releases/latest) and unzip it to a folder you'll keep. (Downloaded the whole repository instead? Use its `extension` folder in the steps below.)

### Chrome, Edge or Opera

1. Open the extensions page: `chrome://extensions`, `edge://extensions` or `opera://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose the `sidesnip` folder.
4. Pin the SideSnip icon to your toolbar (puzzle-piece menu → pin). You'll use it to turn SideSnip on.

### Firefox

Firefox only lets you try unsigned extensions temporarily:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose `sidesnip/manifest.json`.
3. Pin it: puzzle-piece menu → ⚙ next to SideSnip → **Pin to Toolbar**.

Firefox removes temporary add-ons when it closes. **Export your snippets before closing Firefox**, and import them next time.

### Updating

When you get a new version, unzip it **over the same folder** (replacing the old files), then click the **↻ reload** button on the SideSnip card in the extensions page. Your snippets stay put.

> ⚠️ Don't remove the extension to update it. Removing it deletes all your saved snippets. If you ever need to remove it, use **Export** first.

---

## Getting started

SideSnip stays hidden until you want it on a site.

1. Open a job application page.
2. Click the **SideSnip icon** in your toolbar, or press **Alt+Shift+K**. The panel appears, and from now on it shows up on that website automatically.
3. Click **+** to add your first snippet: give it a title (like "LinkedIn") and the text to paste.

---

## Everyday use

### Fill in a form
- **Copy:** click a snippet's title. Your cursor stays in the form, so just press **Ctrl+V**.
- **Type it in for you:** click into a form field, then click **↵** on the snippet.
- **Drag:** drag a snippet by its dotted handle (⋮⋮) and drop it onto a text box.

### Save something you just copied
Click **📋** in the panel's header. The copied text is filled in; add a title and click **Save**.

The first time, SideSnip opens a small window asking for clipboard access, then your browser asks you to confirm. After that it's a single click. If you'd rather not allow it, choose **Not now** and paste the text yourself.

### Keep your resume and other files
- **Add a file:** drag it from your desktop onto the panel. Or click **+**, then **📎** in the form. Files can be up to 10 MB.
- **Upload it to an application:** click **📎** on the file. SideSnip lists the page's upload fields: their names ("Resume/CV", "Cover letter"…) and what each one accepts. Hover over an option to see that field outlined on the page, then click it to attach the file.
- **Or drag it:** drag the file by its dotted handle (⋮⋮) and let go over the page's upload area, or over an email you're writing. The file is attached when you let go.
- **Images:** clicking an image copies the picture, ready to paste.

### Organize with groups
- The buttons under the search box are your groups. You start with **General** and **Work**; add more (for example **Job Applications**) with **+**.
- **Move a snippet to a group:** drag it onto that group's button.
- **Delete a group:** select it, then click its **×** twice. Its snippets aren't lost; they move to **(No group)**.
- **Rename groups:** in Settings.
- **Search:** the search box looks through every group at once.

### Put the panel where you like it
- Drag the panel's header anywhere on the screen.
  - Near the top or bottom edge, it docks into that corner as a slim bar. Click the bar to open or close it.
  - Anywhere else, it floats on the left or right side and shrinks to a small round button when closed.
- Settings also has a little map for picking the position directly.

### Hide it
- Click the **eye** button in the header to turn SideSnip off for the current website.
- Click the toolbar icon to bring it back.

---

## Settings

Open them with the **sliders** button in the panel's header.

- **Position:** the four corners, or floating on the left or right.
- **Theme:** **Auto** matches the website you're on (a dark panel on dark sites, light on light sites), or always **Light** or always **Dark**.
- **Show SideSnip on:** only the sites you turn it on for (the default), or every site.
- **Groups:** rename, add or delete.
- **Backup:** **Export** saves everything (snippets, files and groups) to a file. **Import** adds snippets from a file in the same order, after the ones you already have, and skips any you already have.
- **This site:** turn SideSnip off here.

---

## Your data and privacy

- Everything stays **on your computer, inside your browser**. Nothing is sent anywhere, and websites can't read your snippets.
- Your snippets are still there after you restart the browser or your computer.
- They're deleted only if you remove the extension. Use **Export** now and then as a backup, and to move your snippets to another browser or computer.
- The full details are in the [privacy policy](PRIVACY.md).

**What the browser asks you to allow, and why:**

| Permission | Why SideSnip needs it |
| --- | --- |
| Read and change data on websites | To show the panel and fill in forms on the sites you choose. |
| Read data you copy and paste | Only for "📋 Add copied text". Asked the first time you use it, never before. |
| Store unlimited data | So you can keep files like your resume. |

---

## Troubleshooting

- **The panel isn't showing on a page.** Click the SideSnip toolbar icon.
- **The toolbar icon shows a red "!".** Browsers don't allow extensions on that kind of page: new-tab pages, settings pages, extension stores and PDFs.
- **"Click into a form field first".** Click inside the box you want to fill, then press ↵ on the snippet.
- **A file won't drop into an upload area.** Use **📎** on the file snippet instead. Some forms are embedded in a way that only 📎 can reach.
- **The 📎 list shows several similar options.** Hover over each to see which field it is. Options marked "not visible on the page" are hidden upload buttons the site uses behind the scenes (Gmail has these). They usually still work: "Any file" is for attachments, "Images" for inserting pictures.
- **Firefox: my snippets disappeared.** Firefox removes temporary add-ons when it closes. Import your last export.

---

## Limits

- SideSnip works inside your browser, not in other apps.
- Files can be up to 10 MB each.

Found a bug or have an idea? [Open an issue](https://github.com/shadabdsw/sidesnip/issues).

## License

Free and open source under the [MIT License](LICENSE). © 2026 [shadabdsw](https://github.com/shadabdsw).
