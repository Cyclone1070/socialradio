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
            // Channel services (queue, playback) are allowed to import MediaService from media slice
            if (
              peer === 'media' &&
              (file.endsWith('queue.service.ts') ||
                file.endsWith('playback.service.ts'))
            )
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
        'ScriptContract',
        'VoiceContract',
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

  describe('Rule 5: Zero Bidirectional Slice Coupling (Acyclic Dependency Graph)', () => {
    it('Feature slices must NOT have bidirectional circular dependency cycles with each other', () => {
      const dependencies = new Map<string, Set<string>>();

      // 1. Map contract providers
      const contractProviders = new Map<string, string>(); // ContractName -> SliceName
      for (const slice of featureSlices) {
        dependencies.set(slice, new Set<string>());
        const sliceDir = path.join(rootSrcDir, slice);
        const files = getAllProductionTsFiles(sliceDir);

        for (const file of files) {
          const content = fs.readFileSync(file, 'utf8');
          // Match provide: XContract, useClass/useExisting: ...
          const provideMatch = /provide:\s*([A-Za-z0-9_]*Contract)/g;
          let m: RegExpExecArray | null;
          while ((m = provideMatch.exec(content)) !== null) {
            contractProviders.set(m[1], slice);
          }
        }
      }

      // 2. Map direct slice imports and contract consumption
      for (const slice of featureSlices) {
        const sliceDir = path.join(rootSrcDir, slice);
        const files = getAllProductionTsFiles(sliceDir);

        for (const file of files) {
          const content = fs.readFileSync(file, 'utf8');
          // Direct imports
          for (const otherSlice of featureSlices) {
            if (otherSlice === slice) continue;
            const sliceImportRegex = new RegExp(
              `from\\s+['"](\\.\\./)+${otherSlice}(/.*)?['"]`,
            );
            if (sliceImportRegex.test(content)) {
              dependencies.get(slice)!.add(otherSlice);
            }
          }
          // Contract consumption
          for (const [contract, providerSlice] of contractProviders.entries()) {
            if (providerSlice === slice) continue;
            if (content.includes(contract)) {
              dependencies.get(slice)!.add(providerSlice);
            }
          }
        }
      }

      // Detect 2-slice bidirectional cycles (A -> B and B -> A)
      for (const [sliceA, depsA] of dependencies.entries()) {
        for (const sliceB of depsA) {
          const depsB = dependencies.get(sliceB);
          if (depsB && depsB.has(sliceA)) {
            const errorMsg = `🚨 Architecture Violation: Bidirectional dependency cycle detected between slices [${sliceA}] and [${sliceB}]. This indicates an artificial functional split of a single domain. Consolidate into a single domain slice or enforce strict unidirectional contracts.`;
            expect(errorMsg).toBe('');
          }
        }
      }
    });
  });

  describe('Rule 6: Single Entity Table Ownership (No Duplicate Entities Across Slices)', () => {
    it('Every database entity must be owned exclusively by a single domain slice', () => {
      const tableToSlices = new Map<string, Set<string>>();

      for (const slice of featureSlices) {
        const sliceDir = path.join(rootSrcDir, slice);
        const files = getAllProductionTsFiles(sliceDir).filter((f) =>
          f.endsWith('.entity.ts'),
        );

        for (const file of files) {
          const content = fs.readFileSync(file, 'utf8');
          // Match @Entity() or class name
          const hasEntity = /@Entity\((?:['"]([^'"]+)['"])?\)/.test(content);
          if (hasEntity) {
            const classMatch = /export\s+(?:abstract\s+)?class\s+(\w+)/.exec(
              content,
            );
            if (classMatch) {
              const explicitTableMatch = /@Entity\(['"]([^'"]+)['"]\)/.exec(
                content,
              );
              const tableName = (
                explicitTableMatch ? explicitTableMatch[1] : classMatch[1]
              ).toLowerCase();
              if (!tableToSlices.has(tableName)) {
                tableToSlices.set(tableName, new Set<string>());
              }
              tableToSlices.get(tableName)!.add(slice);
            }
          }
        }
      }

      for (const [table, slices] of tableToSlices.entries()) {
        if (slices.size > 1) {
          const errorMsg = `🚨 Architecture Violation: Duplicate entity mapping detected for table "${table}" in slices [${Array.from(slices).join(', ')}]. Every entity must be owned exclusively by a single domain slice.`;
          expect(errorMsg).toBe('');
        }
      }
    });
  });

  describe('Rule 7: Route Domain Ownership (No Cross-Domain Controller Routes)', () => {
    it('Controllers must only declare routes for their owning domain slice', () => {
      for (const slice of featureSlices) {
        const sliceDir = path.join(rootSrcDir, slice);
        const files = getAllProductionTsFiles(sliceDir).filter((f) =>
          f.endsWith('.controller.ts'),
        );

        for (const file of files) {
          const content = fs.readFileSync(file, 'utf8');
          const controllerMatch = /@Controller\(['"]([^'"]+)['"]\)/g;
          let match: RegExpExecArray | null;
          while ((match = controllerMatch.exec(content)) !== null) {
            const route = match[1];
            // Check if route specifies admin/<otherSlice> or <otherSlice>
            for (const otherSlice of featureSlices) {
              if (otherSlice === slice) continue;
              const belongsToOther =
                route === otherSlice ||
                route === `${otherSlice}s` ||
                route.startsWith(`${otherSlice}/`) ||
                route.startsWith(`${otherSlice}s/`) ||
                route.startsWith(`admin/${otherSlice}`) ||
                route.startsWith(`admin/${otherSlice}s`);

              if (belongsToOther) {
                const errorMsg = `🚨 Architecture Violation: Controller in slice "${slice}" declares route "/${route}" which belongs to domain "${otherSlice}". Controllers must only declare routes for their owning domain.`;
                expect(errorMsg).toBe('');
              }
            }
          }
        }
      }
    });
  });
});
