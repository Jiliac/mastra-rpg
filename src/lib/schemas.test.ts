import { describe, it, expect } from 'vitest';
import {
  FactionOutput,
  NarratorOutput,
  IllustratorOutput,
  ImageMeta,
  type FactionOutput as FactionOutputT,
  type NarratorOutput as NarratorOutputT,
  type IllustratorOutput as IllustratorOutputT,
  type ImageMeta as ImageMetaT,
} from './schemas';

describe('FactionOutput', () => {
  it('accepts a valid {decision, reasoning} object', () => {
    const ok: FactionOutputT = FactionOutput.parse({
      decision: 'Send envoys to the council.',
      reasoning: 'The faction values diplomacy over force in low-stakes contact.',
    });
    expect(ok.decision).toBe('Send envoys to the council.');
  });

  it('rejects empty decision', () => {
    expect(() => FactionOutput.parse({ decision: '', reasoning: 'r' })).toThrow();
  });

  it('rejects empty reasoning', () => {
    expect(() => FactionOutput.parse({ decision: 'd', reasoning: '' })).toThrow();
  });

  it('rejects missing fields', () => {
    expect(() => FactionOutput.parse({ decision: 'd' })).toThrow();
    expect(() => FactionOutput.parse({ reasoning: 'r' })).toThrow();
  });
});

describe('NarratorOutput', () => {
  it('accepts prose-only object (time_passed absent)', () => {
    const ok: NarratorOutputT = NarratorOutput.parse({ prose: 'The harbor wind picks up.' });
    expect(ok.prose).toContain('harbor');
    expect(ok.time_passed).toBeUndefined();
  });

  it('accepts prose + time_passed.days', () => {
    const ok = NarratorOutput.parse({ prose: 'X.', time_passed: { days: 1 } });
    expect(ok.time_passed?.days).toBe(1);
  });

  it('accepts prose + time_passed.hours', () => {
    const ok = NarratorOutput.parse({ prose: 'X.', time_passed: { hours: 6 } });
    expect(ok.time_passed?.hours).toBe(6);
  });

  it('rejects empty prose', () => {
    expect(() => NarratorOutput.parse({ prose: '' })).toThrow();
  });

  it('rejects negative days/hours', () => {
    expect(() => NarratorOutput.parse({ prose: 'X.', time_passed: { days: -1 } })).toThrow();
    expect(() => NarratorOutput.parse({ prose: 'X.', time_passed: { hours: -1 } })).toThrow();
  });

  it('rejects non-integer days/hours', () => {
    expect(() => NarratorOutput.parse({ prose: 'X.', time_passed: { days: 1.5 } })).toThrow();
  });
});

describe('ImageMeta', () => {
  it('accepts a fully-populated image record', () => {
    const ok: ImageMetaT = ImageMeta.parse({
      filename: '20260511-080700-kessha-abc123.png',
      path: '/vault/images/20260511-080700-kessha-abc123.png',
      prompt: 'Kessha at the helm.',
      slug: 'kessha',
    });
    expect(ok.filename.endsWith('.png')).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(() => ImageMeta.parse({ filename: 'a.png', path: '/a.png', prompt: 'x' })).toThrow();
  });
});

describe('IllustratorOutput', () => {
  it('accepts prose_with_embeds plus an empty images array', () => {
    const ok: IllustratorOutputT = IllustratorOutput.parse({
      prose_with_embeds: 'Body without embeds.',
      images: [],
    });
    expect(ok.images).toHaveLength(0);
  });

  it('accepts prose_with_embeds plus one image', () => {
    const ok = IllustratorOutput.parse({
      prose_with_embeds: 'Body with ![[a.png]].',
      images: [
        {
          filename: 'a.png',
          path: '/vault/images/a.png',
          prompt: 'p',
          slug: 's',
        },
      ],
    });
    expect(ok.images[0].slug).toBe('s');
  });

  it('rejects empty prose_with_embeds', () => {
    expect(() => IllustratorOutput.parse({ prose_with_embeds: '', images: [] })).toThrow();
  });

  it('rejects a malformed image in the array', () => {
    expect(() =>
      IllustratorOutput.parse({
        prose_with_embeds: 'X.',
        images: [{ filename: 'a.png' }],
      }),
    ).toThrow();
  });
});
