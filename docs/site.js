// Store and GitHub links for the website. Fill each one in once the listing or repository exists;
// any left empty shows as "Coming soon".
const LINKS = {
  edge: '', // Microsoft Edge Add-ons listing
  opera: '', // Opera add-ons listing
  firefox: '', // addons.mozilla.org listing
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
  a.classList.add('soon');
  a.setAttribute('aria-disabled', 'true');
  a.title = 'Coming soon';
  const pre = a.querySelector('small');
  if (pre) pre.textContent = 'Coming soon';
}
