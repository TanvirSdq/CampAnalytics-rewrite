import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

interface MatchViolation {
  file: string;
  line: number;
  matched: string;
  content: string;
}

// Recursively get all files in a directory matching specific extensions
function getFilesRecursively(dir: string, extensions: string[] = ['.html', '.css', '.js', '.ts']): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getFilesRecursively(fullPath, extensions));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.includes(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

describe('Quality Gate 1: Brand Leak Verification', () => {
  const targetDirs = ['templates', 'public', 'src'];
  const BRAND_LEAK_REGEX = /\b(OWID|XTools|Plausible|Pageviews)\b|(?<!photo|bio|calli)grapher\b/i;

  it('scans templates/, public/, and src/ and asserts 0 prohibited external brand leaks', () => {
    const violations: MatchViolation[] = [];

    for (const relDir of targetDirs) {
      const absDir = path.join(projectRoot, relDir);
      const files = getFilesRecursively(absDir, ['.html', '.css', '.js', '.ts', '.svg']);

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n');

        lines.forEach((line, index) => {
          const match = line.match(BRAND_LEAK_REGEX);
          if (match) {
            violations.push({
              file: path.relative(projectRoot, file),
              line: index + 1,
              matched: match[0],
              content: line.trim()
            });
          }
        });
      }
    }

    if (violations.length > 0) {
      const details = violations
        .map((v) => `  - ${v.file}:${v.line} [matched "${v.matched}"]: ${v.content}`)
        .join('\n');
      assert.fail(`Brand leak violations detected (${violations.length} matches):\n${details}`);
    }

    assert.equal(violations.length, 0, 'Must have zero prohibited brand leaks');
  });

  it('verifies that legitimate domain terms like "photographer" are preserved and not flagged', () => {
    const legitimateStrings = [
      'Top Contributing Photographers',
      'photographer leaderboard',
      'biographer notes',
      'calligrapher signature'
    ];

    for (const text of legitimateStrings) {
      assert.equal(
        BRAND_LEAK_REGEX.test(text),
        false,
        `Term "${text}" should NOT be flagged as a brand leak`
      );
    }

    const prohibitedStrings = [
      'OWID Pill Strip Pattern',
      'Grapher visualization',
      'Powered by XTools API',
      'Plausible analytics tracker',
      'Pageviews comparison tool'
    ];

    for (const text of prohibitedStrings) {
      assert.equal(
        BRAND_LEAK_REGEX.test(text),
        true,
        `Term "${text}" MUST be flagged as a brand leak`
      );
    }
  });

  it('verifies public/css/styles.css specifically has 0 occurrences of OWID', () => {
    const cssPath = path.join(projectRoot, 'public/css/styles.css');
    if (fs.existsSync(cssPath)) {
      const cssContent = fs.readFileSync(cssPath, 'utf8');
      const matches = cssContent.match(/\bOWID\b/i);
      assert.equal(matches, null, 'public/css/styles.css must contain zero occurrences of OWID');
    }
  });
});

describe('Quality Gate 2: Geometry & Gradients Verification', () => {
  it('asserts 0 non-zero border-radius declarations in public/css/styles.css', () => {
    const cssPath = path.join(projectRoot, 'public/css/styles.css');
    assert.ok(fs.existsSync(cssPath), 'public/css/styles.css must exist');

    const cssContent = fs.readFileSync(cssPath, 'utf8');
    const lines = cssContent.split('\n');
    const violations: { line: number; raw: string; value: string }[] = [];

    // Regex to match border-radius property declaration: border-radius: <value>;
    const BORDER_RADIUS_PROP_REGEX = /(?:^|[;{}]\s*)border(?:-[a-z]+)*-radius\s*:\s*([^;!}]+)/i;

    lines.forEach((line, idx) => {
      // Ignore comment lines
      const trimmed = line.trim();
      if (trimmed.startsWith('/*') || trimmed.startsWith('*')) return;

      const match = trimmed.match(BORDER_RADIUS_PROP_REGEX);
      if (match) {
        const val = match[1].trim();
        // Permitted values: 0, 0px, 0 0 0 0, 0px 0px 0px 0px, none, inherit, initial
        const isZeroOrNone = /^0+(?:px)?(?:\s+0+(?:px)?)*$/i.test(val) || /^(none|inherit|initial)$/i.test(val);
        if (!isZeroOrNone) {
          violations.push({
            line: idx + 1,
            raw: trimmed,
            value: val
          });
        }
      }
    });

    if (violations.length > 0) {
      const details = violations
        .map((v) => `  - Line ${v.line}: "${v.raw}" (value: "${v.value}")`)
        .join('\n');
      assert.fail(`Non-zero border-radius violations in public/css/styles.css (${violations.length} violations):\n${details}`);
    }

    assert.equal(violations.length, 0, 'public/css/styles.css must contain zero non-zero border-radius declarations');
  });

  it('asserts 0 non-zero border-radius declarations in inline template styles', () => {
    const templateFiles = getFilesRecursively(path.join(projectRoot, 'templates'), ['.html']);
    const violations: { file: string; line: number; raw: string }[] = [];
    const BORDER_RADIUS_INLINE_REGEX = /border(?:-[a-z]+)*-radius\s*:\s*([^;"]+)/gi;

    for (const file of templateFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, idx) => {
        let match: RegExpExecArray | null;
        while ((match = BORDER_RADIUS_INLINE_REGEX.exec(line)) !== null) {
          const val = match[1].trim();
          const isZero = /^0+(?:px)?(?:\s+0+(?:px)?)*$/i.test(val) || /^(none|inherit|initial)$/i.test(val);
          if (!isZero) {
            violations.push({
              file: path.relative(projectRoot, file),
              line: idx + 1,
              raw: line.trim()
            });
          }
        }
      });
    }

    if (violations.length > 0) {
      const details = violations
        .map((v) => `  - ${v.file}:${v.line}: ${v.raw}`)
        .join('\n');
      assert.fail(`Non-zero inline border-radius found in templates (${violations.length} violations):\n${details}`);
    }

    assert.equal(violations.length, 0, 'Templates must contain zero non-zero border-radius inline styles');
  });

  it('asserts 0 CSS gradients across public/css/, templates/, and src/', () => {
    const targetDirs = ['public/css', 'templates', 'src'];
    const GRADIENT_REGEX = /\b(linear-gradient|radial-gradient|conic-gradient|repeating-linear-gradient|repeating-radial-gradient)\b/i;
    const violations: MatchViolation[] = [];

    for (const relDir of targetDirs) {
      const absDir = path.join(projectRoot, relDir);
      const files = getFilesRecursively(absDir, ['.css', '.html', '.ts', '.js']);

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n');

        lines.forEach((line, index) => {
          const match = line.match(GRADIENT_REGEX);
          if (match) {
            violations.push({
              file: path.relative(projectRoot, file),
              line: index + 1,
              matched: match[0],
              content: line.trim()
            });
          }
        });
      }
    }

    if (violations.length > 0) {
      const details = violations
        .map((v) => `  - ${v.file}:${v.line} [${v.matched}]: ${v.content}`)
        .join('\n');
      assert.fail(`CSS gradient violations detected (${violations.length} violations):\n${details}`);
    }

    assert.equal(violations.length, 0, 'Codebase must contain zero CSS gradients');
  });

  it('asserts 0 non-zero rx or ry corner rounding attributes on SVG rect elements', () => {
    const targetDirs = ['templates', 'src'];
    const SVG_ROUNDING_REGEX = /<rect[^>]*\b(rx|ry)\s*=\s*["'](?!0\b)([^"']+)["']/i;
    const violations: MatchViolation[] = [];

    for (const relDir of targetDirs) {
      const absDir = path.join(projectRoot, relDir);
      const files = getFilesRecursively(absDir, ['.html', '.ts']);

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n');

        lines.forEach((line, index) => {
          const match = line.match(SVG_ROUNDING_REGEX);
          if (match) {
            violations.push({
              file: path.relative(projectRoot, file),
              line: index + 1,
              matched: match[0],
              content: line.trim()
            });
          }
        });
      }
    }

    assert.equal(
      violations.length,
      0,
      `SVG <rect> elements must not have rounded corners: ${JSON.stringify(violations)}`
    );
  });
});

describe('Quality Gate 3: Header Hygiene Verification', () => {
  const primaryToolTemplates = ['influx.html', 'mobility.html', 'diversity.html', 'quality.html', 'utility.html'];

  for (const tpl of primaryToolTemplates) {
    it(`verifies templates/${tpl} has 0 subtitle paragraphs directly under page title`, () => {
      const tplPath = path.join(projectRoot, 'templates', tpl);
      assert.ok(fs.existsSync(tplPath), `Template ${tpl} must exist`);

      const content = fs.readFileSync(tplPath, 'utf8');

      // Check for <p class="page-subtitle"> anywhere in the template header block
      const hasSubtitleParagraph = /<p\s+class=["'][^"']*page-subtitle[^"']*["']/i.test(content);
      assert.equal(
        hasSubtitleParagraph,
        false,
        `Template ${tpl} must not contain <p class="page-subtitle"> directly under page title`
      );

      // Also ensure that the page title container does not contain explanatory paragraphs
      const titleBlockMatch = content.match(/<h1\s+class=["']page-title["'][^>]*>[\s\S]*?<\/div>/i);
      if (titleBlockMatch) {
        const titleBlock = titleBlockMatch[0];
        const hasParagraphUnderTitle = /<p\b[^>]*>/i.test(titleBlock);
        assert.equal(
          hasParagraphUnderTitle,
          false,
          `Template ${tpl} title container must not have explanatory <p> elements: ${titleBlock}`
        );
      }
    });
  }

  it('verifies retention.html and health.html also maintain clean header hygiene', () => {
    for (const tpl of ['retention.html', 'health.html']) {
      const tplPath = path.join(projectRoot, 'templates', tpl);
      if (fs.existsSync(tplPath)) {
        const content = fs.readFileSync(tplPath, 'utf8');
        const hasSubtitle = /<p\s+class=["'][^"']*page-subtitle[^"']*["']/i.test(content);
        assert.equal(
          hasSubtitle,
          false,
          `Template ${tpl} should maintain clean header hygiene without <p class="page-subtitle">`
        );
      }
    }
  });
});
