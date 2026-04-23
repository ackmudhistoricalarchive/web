document.querySelectorAll('.story-card .story-header').forEach((button) => {
  button.addEventListener('click', () => {
    const card = button.closest('.story-card');
    if (!card) {
      return;
    }
    const open = card.getAttribute('data-open') === 'true';
    card.setAttribute('data-open', open ? 'false' : 'true');
  });
});
