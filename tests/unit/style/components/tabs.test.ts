import * as fs from 'node:fs';
import * as path from 'node:path';

describe('tab attention styles', () => {
  const tabsCss = fs.readFileSync(
    path.join(process.cwd(), 'src/style/components/tabs.css'),
    'utf8',
  );

  it('visually distinguishes review from action-required attention', () => {
    expect(tabsCss).toMatch(
      /\.scribe-tab-badge-review \{[\s\S]*?border-color: var\(--color-green\);[\s\S]*?\}/,
    );
    expect(tabsCss).toMatch(
      /\.scribe-tab-badge-review-error \{[\s\S]*?border-color: var\(--text-error\);[\s\S]*?\}/,
    );
    expect(tabsCss).toMatch(
      /\.scribe-tab-badge-action-required \{[\s\S]*?border-color: var\(--color-orange\);[\s\S]*?\}/,
    );
  });

  it('uses theme-neutral working borders without provider overrides', () => {
    expect(tabsCss).toMatch(
      /\.scribe-tab-badge-streaming \{[\s\S]*?border-color: var\(--text-normal\);[\s\S]*?\}/,
    );
    expect(tabsCss).toMatch(
      /body\.theme-light (?:button)?\.scribe-tab-badge-streaming \{[\s\S]*?border-color: #000(?:000)?;[\s\S]*?\}/,
    );
    expect(tabsCss).toMatch(
      /body\.theme-dark (?:button)?\.scribe-tab-badge-streaming \{[\s\S]*?border-color: #fff(?:fff)?;[\s\S]*?\}/,
    );
    expect(tabsCss).not.toMatch(
      /\.scribe-tab-badge-streaming\[data-provider=/,
    );
  });
});
