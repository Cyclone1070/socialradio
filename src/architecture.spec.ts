import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

describe('True Peer Decoupling Architecture Guardrails', () => {
  const rootSrcDir = __dirname;
  const domainDir = path.join(rootSrcDir, 'domain');
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
            const crossSliceImport = new RegExp(
              `from\\s+['"](\\.\\./)+${peer}(/.*)?['"]`,
            );
            expect(content).not.toMatch(crossSliceImport);
          }
        }
      }
    });
  });

  describe('Rule 3: Pure POCOs & Scalar ID Foreign Entities across Slices', () => {
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

    it('Entity files across feature slices must be pure POCOs with ZERO ORM decorators', () => {
      for (const slice of featureSlices) {
        const sliceDir = path.join(rootSrcDir, slice);
        const files = getAllProductionTsFiles(sliceDir).filter((f) =>
          f.endsWith('.entity.ts'),
        );

        for (const file of files) {
          const content = fs.readFileSync(file, 'utf8');
          expect(content).not.toMatch(/@Entity\s*\(/);
          expect(content).not.toMatch(/@Column\s*\(/);
          expect(content).not.toMatch(/@PrimaryGeneratedColumn\s*\(/);
          expect(content).not.toMatch(/@ManyToOne\s*\(/);
          expect(content).not.toMatch(/@OneToMany\s*\(/);
          expect(content).not.toMatch(/@ManyToMany\s*\(/);
          expect(content).not.toMatch(/from\s+['"]typeorm['"]/);
        }
      }
    });
  });

  describe('Rule 4: Domain Anti-Dumping Guardrail', () => {
    it('Contracts and data interfaces in src/domain/ must be cross-slice (consumed across feature slices)', () => {
      const domainFiles = getAllProductionTsFiles(domainDir);
      const domainExports = new Set<string>();

      for (const file of domainFiles) {
        const content = fs.readFileSync(file, 'utf8');
        const exportMatch =
          /export\s+(?:abstract\s+class|interface|type|const)\s+([A-Za-z0-9_]+)/g;
        let m: RegExpExecArray | null;
        while ((m = exportMatch.exec(content)) !== null) {
          domainExports.add(m[1]);
        }
      }

      expect(domainExports.size).toBeGreaterThan(0);

      const contractsFile = path.join(domainDir, 'contracts', 'index.ts');
      const contractsContent = fs.existsSync(contractsFile)
        ? fs.readFileSync(contractsFile, 'utf8')
        : '';

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

        const isPartOfContract = contractsContent.includes(symbol);
        const isCrossSlice = consumingSlices.size >= 2;

        if (!isCrossSlice && !isPartOfContract) {
          const errorMsg = `🚨 Anti-Dumping Violation: Symbol "${symbol}" in src/domain/ is only consumed by ${consumingSlices.size} slice(s) ([${Array.from(consumingSlices).join(', ')}]) and is not part of any Domain Contract signature. Move private types into the owning feature slice.`;
          expect(errorMsg).toBe('');
        }
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

  describe('Rule 8: Entity Encapsulation Guardrails', () => {
    let ls: ts.LanguageService;
    let program: ts.Program;
    let entityFiles: string[];

    beforeAll(() => {
      const configPath = ts.findConfigFile(
        path.resolve(__dirname, '..'),
        (f) => ts.sys.fileExists(f),
        'tsconfig.json',
      )!;
      const configFile = ts.readConfigFile(configPath, (f) =>
        ts.sys.readFile(f),
      );
      const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(configPath),
      );

      const host: ts.LanguageServiceHost = {
        getScriptFileNames: () => parsed.fileNames,
        getScriptVersion: () => '1',
        getScriptSnapshot: (f) =>
          ts.sys.fileExists(f)
            ? ts.ScriptSnapshot.fromString(ts.sys.readFile(f)!)
            : undefined,
        getCurrentDirectory: () => path.dirname(configPath),
        getCompilationSettings: () => parsed.options,
        getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
        fileExists: (f) => ts.sys.fileExists(f),
        readFile: (f) => ts.sys.readFile(f),
        readDirectory: (dir, extensions, excludes, includes, depth) =>
          ts.sys.readDirectory(dir, extensions, excludes, includes, depth),
        directoryExists: (dir) => ts.sys.directoryExists?.(dir) ?? false,
        getDirectories: (dir) => ts.sys.getDirectories(dir),
      };

      ls = ts.createLanguageService(host, ts.createDocumentRegistry());
      program = ls.getProgram()!;

      function findEntities(dir: string): string[] {
        const res: string[] = [];
        if (!fs.existsSync(dir)) return res;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) res.push(...findEntities(full));
          else if (entry.name.endsWith('.entity.ts')) res.push(full);
        }
        return res;
      }
      entityFiles = findEntities(rootSrcDir);
    }, 30000);

    it('Public setters on domain entities must be exercised in production code or declared private set', () => {
      const unusedSetters: string[] = [];

      for (const entityFile of entityFiles) {
        const sf = program.getSourceFile(entityFile);
        if (!sf) continue;

        sf.forEachChild((node) => {
          if (ts.isClassDeclaration(node) && node.name) {
            const className = node.name.text;
            node.members.forEach((member) => {
              if (ts.isSetAccessor(member)) {
                const isPrivate = member.modifiers?.some(
                  (m) =>
                    m.kind === ts.SyntaxKind.PrivateKeyword ||
                    m.kind === ts.SyntaxKind.ProtectedKeyword,
                );
                if (!isPrivate) {
                  const name = member.name.getText(sf);
                  const refs =
                    ls.findReferences(entityFile, member.name.getStart(sf)) ||
                    [];
                  const allEntries = refs.flatMap((r) => r.references);
                  const externalWrites = allEntries.filter(
                    (e) =>
                      !e.isDefinition &&
                      !e.fileName.endsWith('.spec.ts') &&
                      e.isWriteAccess,
                  );
                  if (externalWrites.length === 0) {
                    unusedSetters.push(
                      `${className}.${name} (${path.relative(rootSrcDir, entityFile)})`,
                    );
                  }
                }
              }
            });
          }
        });
      }

      expect(unusedSetters).toEqual([]);
    });

    it('Entity Date and Array getters must prevent mutable reference leaks', () => {
      const mutableLeaks: string[] = [];

      for (const entityFile of entityFiles) {
        const sf = program.getSourceFile(entityFile);
        if (!sf) continue;

        sf.forEachChild((node) => {
          if (ts.isClassDeclaration(node) && node.name) {
            const className = node.name.text;
            node.members.forEach((member) => {
              if (ts.isGetAccessor(member) && member.type) {
                const returnTypeStr = member.type.getText(sf);
                const name = member.name.getText(sf);
                const bodyStr = member.body?.getText(sf) || '';

                if (returnTypeStr.includes('Date')) {
                  if (!bodyStr.includes('new Date(')) {
                    mutableLeaks.push(
                      `Date leak: ${className}.${name} returns Date directly without defensive clone (new Date(...))`,
                    );
                  }
                }

                if (
                  returnTypeStr.includes('[]') ||
                  returnTypeStr.startsWith('Array<')
                ) {
                  if (
                    !returnTypeStr.includes('readonly') &&
                    !bodyStr.includes('Object.freeze') &&
                    !returnTypeStr.includes('Collection')
                  ) {
                    mutableLeaks.push(
                      `Array leak: ${className}.${name} returns mutable array without readonly/Object.freeze or Collection`,
                    );
                  }
                }
              }
            });
          }
        });
      }

      expect(mutableLeaks).toEqual([]);
    });
  });

  describe('Rule 13: MikroORM module registration matches injected repositories', () => {
    it('registers exactly the schemas that repositories are injected for', () => {
      const files = getAllProductionTsFiles(rootSrcDir);
      const registered = new Map<string, string>();
      const injected = new Map<string, string>();

      for (const file of files) {
        const relative = path.relative(rootSrcDir, file);
        const source = fs.readFileSync(file, 'utf-8');

        for (const match of source.matchAll(
          /MikroOrmModule\.forFeature\(\s*\[([^\]]*)\]/g,
        )) {
          for (const name of match[1]
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)) {
            if (!registered.has(name)) registered.set(name, relative);
          }
        }

        for (const match of source.matchAll(
          /@InjectRepository\(\s*([A-Za-z0-9_]+)\s*\)/g,
        )) {
          if (!injected.has(match[1])) injected.set(match[1], relative);
        }
      }

      const registeredWithoutRepository = [...registered]
        .filter(([name]) => !injected.has(name))
        .map(([name, file]) => `${name} (${file})`);
      const repositoryWithoutRegistration = [...injected]
        .filter(([name]) => !registered.has(name))
        .map(([name, file]) => `${name} (${file})`);

      expect({
        registeredWithoutRepository,
        repositoryWithoutRegistration,
      }).toEqual({
        registeredWithoutRepository: [],
        repositoryWithoutRegistration: [],
      });
    });
  });

  describe('Rule 14: no casts that bypass the type system', () => {
    it('production code must not use `as unknown as` double casts', () => {
      const offenders: string[] = [];

      for (const file of getAllProductionTsFiles(rootSrcDir)) {
        const source = fs.readFileSync(file, 'utf-8');
        source.split('\n').forEach((line, index) => {
          if (line.includes('as unknown as')) {
            offenders.push(`${path.relative(rootSrcDir, file)}:${index + 1}`);
          }
        });
      }

      expect(offenders).toEqual([]);
    });
  });
});
