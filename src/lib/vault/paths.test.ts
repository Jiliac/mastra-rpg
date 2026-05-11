import { describe, it, expect } from 'vitest';
import {
  vaultRoot,
  worldXmlPath,
  threadsXmlPath,
  characterXmlPath,
  styleGuidePath,
  zeroMapPath,
  journalPath,
  factionsDir,
  npcsDir,
  locationsDir,
  factionPath,
  npcPath,
  locationPath,
} from './paths';

const FIXTURE = 'tests/fixtures/test-vault';

describe('paths', () => {
  it('vaultRoot resolves slug under <cwd>/vaults', () => {
    const root = vaultRoot('commodore-vex');
    expect(root.endsWith('/vaults/commodore-vex')).toBe(true);
    expect(root.startsWith('/')).toBe(true);
  });

  it('top-level file paths join under root', () => {
    const root = FIXTURE;
    expect(worldXmlPath(root)).toBe(`${FIXTURE}/world.xml`);
    expect(threadsXmlPath(root)).toBe(`${FIXTURE}/threads.xml`);
    expect(characterXmlPath(root)).toBe(`${FIXTURE}/character.xml`);
    expect(styleGuidePath(root)).toBe(`${FIXTURE}/style-guide.md`);
    expect(zeroMapPath(root)).toBe(`${FIXTURE}/0-Map.md`);
    expect(journalPath(root)).toBe(`${FIXTURE}/journal.md`);
  });

  it('kind-folder helpers return directory paths', () => {
    expect(factionsDir(FIXTURE)).toBe(`${FIXTURE}/factions`);
    expect(npcsDir(FIXTURE)).toBe(`${FIXTURE}/npcs`);
    expect(locationsDir(FIXTURE)).toBe(`${FIXTURE}/locations`);
  });

  it('entity helpers append slug + .md', () => {
    expect(factionPath(FIXTURE, 'red-banner')).toBe(`${FIXTURE}/factions/red-banner.md`);
    expect(npcPath(FIXTURE, 'kessha')).toBe(`${FIXTURE}/npcs/kessha.md`);
    expect(locationPath(FIXTURE, 'iron-promise')).toBe(`${FIXTURE}/locations/iron-promise.md`);
  });
});
