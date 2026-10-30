export async function showNavGroup(root, name) {
  const button = root.getByRole('button', { name, exact: true })
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click()
}
