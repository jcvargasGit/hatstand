// Steps of the task form that every suite repeats.

/** Chooses repositories in the window the task form opens for them. */
export async function chooseRepositories(scope, names) {
  await scope.getByRole('button', { name: /^(Choose|Change) repositories$/ }).click();
  const dialog = scope.page ? scope.page().getByRole('dialog', { name: 'Choose repositories' }) : scope.getByRole('dialog', { name: 'Choose repositories' });
  for (const name of names) await dialog.getByRole('checkbox', { name, exact: true }).check();
  await dialog.getByRole('button', { name: /^Use (this repository|these \d+ repositories)$/ }).click();
  await dialog.waitFor({ state: 'hidden' });
}
