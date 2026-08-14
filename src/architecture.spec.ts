import * as fs from 'fs';
import * as path from 'path';

describe('True Peer Decoupling Architecture Guardrails', () => {
  const rootSrcDir = __dirname;
  const featureSlices = fs
    .readdirSync(rootSrcDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !['domain', 'infrastructure'].includes(entry.name),
    )
    .map((entry) => entry.name);

  function getAllProductionTsFiles(dir: string): string[] {
    const files: string[] = [];
    if (!fs.existsSync(dir)) return files;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getAllProductionTsFiles(fullPath));
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.spec.ts')
      ) {
        files.push(fullPath);
      }
    }
    return files;
  }

  describe('Rule 1: Domain Isolation (src/domain)', () => {
    const domainDir = path.join(rootSrcDir, 'domain');

    it('src/domain/ must not import from any feature slice or infrastructure', () => {
      const files = getAllProductionTsFiles(domainDir);
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        for (const slice of featureSlices) {
          const sliceImport = new RegExp(
            `from\\s+['"].*\\/${slice}(\\/.*)?['"]`,
          );
          expect(content).not.toMatch(sliceImport);
        }
        expect(content).not.toMatch(/from\s+['"].*\/infrastructure(\/.*)?['"]/);
      }
    });

    it('src/domain/ must contain ZERO ORM or NestJS decorators', () => {
      const files = getAllProductionTsFiles(domainDir);
      const forbiddenDecorators = [
        /@Entity\s*\(/,
        /@Injectable\s*\(/,
        /@Module\s*\(/,
        /@Controller\s*\(/,
        /@Column\s*\(/,
        /@ManyToOne\s*\(/,
        /@OneToMany\s*\(/,
        /from\s+['"]typeorm['"]/,
        /from\s+['"]@nestjs\/typeorm['"]/,
      ];

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        for (const pattern of forbiddenDecorators) {
          expect(content).not.toMatch(pattern);
        }
      }
    });

    it('src/domain/ must contain ZERO concrete class definitions or executable functions', () => {
      const files = getAllProductionTsFiles(domainDir);

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        // No non-abstract export class allowed
        expect(content).not.toMatch(/export\s+class\s+\w+/);
        // No function implementations
        expect(content).not.toMatch(/export\s+function\s+/);
      }
    });
  });

  describe('Rule 2: Zero Cross-Slice Concrete Imports', () => {
    it('Feature slices must NOT import concrete non-module files from peer slices', () => {
      for (const slice of featureSlices) {
        const peerSlices = featureSlices.filter((s) => s !== slice);
        const sliceDir = path.join(rootSrcDir, slice);
        const files = getAllProductionTsFiles(sliceDir);

        for (const file of files) {
          // NestJS modules wiring (.module.ts) are allowed to import peer modules
          if (file.endsWith('.module.ts')) continue;

          const content = fs.readFileSync(file, 'utf8');
          for (const peer of peerSlices) {
            // Controllers are allowed to import Auth Guards / Roles from user slice
            if (peer === 'user' && file.endsWith('.controller.ts')) continue;
            // Segment service is allowed to import MediaService from media slice
            if (peer === 'media' && file.endsWith('segment.service.ts'))
              continue;

            const crossSliceImport = new RegExp(
              `from\\s+['"](\\.\\./)+${peer}(/.*)?['"]`,
            );
            expect(content).not.toMatch(crossSliceImport);
          }
        }
      }
    });
  });

  describe('Rule 3: Scalar ID Foreign Entities Only across Slices', () => {
    it('Entity files across feature slices must NOT import entity classes from peer slices', () => {
      for (const slice of featureSlices) {
        const peerSlices = featureSlices.filter((s) => s !== slice);
        const sliceDir = path.join(rootSrcDir, slice);
        const files = getAllProductionTsFiles(sliceDir).filter((f) =>
          f.endsWith('.entity.ts'),
        );

        for (const file of files) {
          const content = fs.readFileSync(file, 'utf8');
          for (const peer of peerSlices) {
            const crossEntityImport = new RegExp(
              `from\\s+['"](\\.\\./)+${peer}/.*entity['"]`,
            );
            expect(content).not.toMatch(crossEntityImport);
          }
        }
      }
    });
  });

  describe('Rule 4: Domain Anti-Dumping Guardrail', () => {
    it('Contracts and data interfaces in src/domain/ must be cross-slice (consumed across feature slices)', () => {
      const domainExports = [
        'ContentContract',
        'ChannelContract',
        'ScriptContract',
        'VoiceContract',
        'SegmentContract',
        'PostData',
        'CommentData',
        'ScriptData',
        'TalkData',
      ];

      for (const symbol of domainExports) {
        const consumingSlices = new Set<string>();
        for (const slice of featureSlices) {
          const sliceDir = path.join(rootSrcDir, slice);
          const files = getAllProductionTsFiles(sliceDir);
          for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            if (content.includes(symbol)) {
              consumingSlices.add(slice);
            }
          }
        }
        // Must be used across 2 or more feature slices
        expect(consumingSlices.size).toBeGreaterThanOrEqual(2);
      }
    });
  });
});
