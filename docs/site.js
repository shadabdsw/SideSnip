// Store and GitHub links for the website. Fill each one in once the listing or repository exists;
// any left empty shows as "Coming soon", or stays hidden if its button is marked data-optional.
const LINKS = {
  opera: 'https://addons.opera.com/extensions/details/sidesnip/', // Opera add-ons listing
  firefox: 'https://addons.mozilla.org/firefox/addon/sidesnip/', // addons.mozilla.org listing (no locale, so it opens in the visitor's language)
  edge: '', // Microsoft Edge Add-ons listing
  chrome: '', // Chrome Web Store listing
  github: 'https://github.com/shadabdsw/sidesnip',
  releases: 'https://github.com/shadabdsw/sidesnip/releases/latest', // 404s until the first GitHub release exists
  issues: 'https://github.com/shadabdsw/sidesnip/issues',
  author: 'https://github.com/shadabdsw',
};

for (const a of document.querySelectorAll('[data-link]')) {
  const url = LINKS[a.dataset.link];
  if (url) {
    a.href = url;
    a.rel = 'noopener';
    continue;
  }
  if (a.hasAttribute('data-optional')) {
    a.hidden = true;
    continue;
  }
  a.classList.add('soon');
  a.setAttribute('aria-disabled', 'true');
  a.title = 'Coming soon';
  const pre = a.querySelector('small');
  if (pre) pre.textContent = 'Coming soon';
}
