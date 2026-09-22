import * as migration_20260922_031113_initial from './20260922_031113_initial';

export const migrations = [
  {
    up: migration_20260922_031113_initial.up,
    down: migration_20260922_031113_initial.down,
    name: '20260922_031113_initial'
  },
];
