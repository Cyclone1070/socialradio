import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const rootSrcDir = __dirname;
const repoRoot = path.join(__dirname, '..');
const schemasDir = path.join(
  rootSrcDir,
  'infrastructure',
  'database',
  'schemas',
);

/**
 * The only slice-to-slice imports allowed.
 *
 * Slices may import each other, but only along these edges and only in this
 * direction. An edge is a decision: adding one here is a one-line diff that says
 * "this slice now needs that one, on purpose". The list is acyclic, which is what
 * keeps the graph from growing a cycle nobody meant.
 */
const SLICE_EDGES: Record<string, string[]> = {
  channel: ['content', 'script', 'voice', 'media', 'user'],
  content: ['user'],
  script: ['content'],
  voice: ['script'],
};

const slices = fs
  .readdirSync(rootSrcDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'infrastructure')
  .map((entry) => entry.name)
  .sort();

function isProductionFile(file: string): boolean {
  return file.endsWith('.ts') && !file.endsWith('.spec.ts');
}

function productionFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...productionFiles(fullPath));
    } else if (entry.isFile() && isProductionFile(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function relative(file: string): string {
  return path.relative(rootSrcDir, file).split(path.sep).join('/');
}

/** The slice a file belongs to, or null for the composition root. */
function sliceOf(file: string): string | null {
  const rel = path.relative(rootSrcDir, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const [first] = rel.split(path.sep);
  return slices.includes(first) ? first : null;
}

/**
 * Every module specifier a file pulls in: static imports and re-exports, plus
 * `import()` and `require()`. A dependency the guard cannot see is a dependency
 * the guard cannot stop.
 */
function importsOf(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf-8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const isDynamicImport =
        node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const argument = node.arguments[0];
      if ((isDynamicImport || isRequire) && ts.isStringLiteral(argument)) {
        specifiers.push(argument.text);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return specifiers;
}

/**
 * Where a specifier points, or null when it is not an in-repo module.
 *
 * `tsconfig.json` sets `baseUrl: "./"`, so `src/channel/...` compiles as well as
 * `../channel/...` does. Both have to resolve to the same place here, or one of
 * them is a blind spot.
 */
function resolveSpecifier(file: string, specifier: string): string | null {
  if (specifier.startsWith('.')) {
    return path.resolve(path.dirname(file), specifier);
  }

  const candidate = path.resolve(repoRoot, specifier);
  const insideRepo = candidate.startsWith(repoRoot + path.sep);
  const insideSrc = candidate.startsWith(rootSrcDir + path.sep);
  return insideRepo && insideSrc ? candidate : null;
}

function escapesSrc(file: string, specifier: string): boolean {
  if (!specifier.startsWith('.')) return false;
  const resolved = resolveSpecifier(file, specifier);
  if (!resolved) return false;
  const rel = path.relative(rootSrcDir, resolved);
  return rel.startsWith('..') || path.isAbsolute(rel);
}

interface Edge {
  from: string;
  to: string;
  file: string;
}

function unlistedEdges(
  edges: Edge[],
  allowed: Record<string, string[]>,
): string[] {
  return edges
    .filter((edge) => !(allowed[edge.from] ?? []).includes(edge.to))
    .map((edge) => `${edge.file}: ${edge.from} -> ${edge.to}`);
}

/** The first cycle in the allowlist, as the path that closes it. */
function cyclePath(edges: Record<string, string[]>): string[] | null {
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (slice: string): string[] | null => {
    if (state.get(slice) === 'done') return null;
    if (state.get(slice) === 'visiting') {
      return [...stack.slice(stack.indexOf(slice)), slice];
    }

    state.set(slice, 'visiting');
    stack.push(slice);
    for (const next of edges[slice] ?? []) {
      const found = visit(next);
      if (found) return found;
    }
    stack.pop();
    state.set(slice, 'done');
    return null;
  };

  for (const slice of Object.keys(edges)) {
    const found = visit(slice);
    if (found) return found;
  }
  return null;
}

/** Every cross-slice import in src, as edges of the slice graph. */
function sliceEdges(): Edge[] {
  const edges: Edge[] = [];

  for (const slice of slices) {
    for (const file of productionFiles(path.join(rootSrcDir, slice))) {
      for (const specifier of importsOf(file)) {
        const target = resolveSpecifier(file, specifier);
        if (!target) continue;
        const targetSlice = sliceOf(target);
        if (!targetSlice || targetSlice === slice) continue;
        edges.push({ from: slice, to: targetSlice, file: relative(file) });
      }
    }
  }

  return edges;
}

describe('Rule 1: the slice graph is an allowlist', () => {
  it('cross-slice imports flow only along the declared edges', () => {
    const edges = sliceEdges();

    // Without this, an empty collector or a renamed folder would make the rule
    // pass by having nothing to check.
    expect(slices.length).toBeGreaterThanOrEqual(6);
    expect(edges.length).toBeGreaterThanOrEqual(8);
    expect(unlistedEdges(edges, SLICE_EDGES)).toEqual([]);
  });

  it('reports an edge that is not on the list', () => {
    expect(
      unlistedEdges(
        [{ from: 'user', to: 'channel', file: 'user/user.service.ts' }],
        SLICE_EDGES,
      ),
    ).toEqual(['user/user.service.ts: user -> channel']);
  });
});

describe('Rule 1b: the allowlist is a graph, not a wish', () => {
  it('names only real slices and contains no cycle', () => {
    for (const [from, targets] of Object.entries(SLICE_EDGES)) {
      expect(slices).toContain(from);
      for (const target of targets) expect(slices).toContain(target);
    }
    expect(cyclePath(SLICE_EDGES)).toBeNull();
  });

  it('finds a cycle when one exists', () => {
    expect(cyclePath({ content: ['script'], script: ['content'] })).toEqual([
      'content',
      'script',
      'content',
    ]);
  });
});

describe('Rule 2: infrastructure is below every slice', () => {
  // The ORM mapping is the one place that has to name the classes it maps, so
  // `database/schemas` is allowed to see entities - and nothing else.
  const mappingDir = schemasDir;

  it('infrastructure imports no slice', () => {
    const offenders: string[] = [];

    for (const file of productionFiles(
      path.join(rootSrcDir, 'infrastructure'),
    )) {
      if (file.startsWith(mappingDir + path.sep)) continue;
      for (const specifier of importsOf(file)) {
        const target = resolveSpecifier(file, specifier);
        if (!target) continue;
        const targetSlice = sliceOf(target);
        if (targetSlice) offenders.push(`${relative(file)} -> ${targetSlice}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the schema mapping imports only entity files', () => {
    const offenders: string[] = [];

    for (const file of productionFiles(mappingDir)) {
      for (const specifier of importsOf(file)) {
        const target = resolveSpecifier(file, specifier);
        if (!target) continue;
        if (!sliceOf(target)) continue;
        if (!target.endsWith('.entity')) {
          offenders.push(`${relative(file)} -> ${relative(target)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('Rule 3: the app is one package', () => {
  it('production code never imports past src by relative path', () => {
    const offenders: string[] = [];

    for (const file of productionFiles(rootSrcDir)) {
      for (const specifier of importsOf(file)) {
        if (escapesSrc(file, specifier)) {
          offenders.push(`${relative(file)} -> ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('Rule 4: entities do not reference peer entities', () => {
  function entityFiles(): string[] {
    return productionFiles(rootSrcDir).filter((f) => f.endsWith('.entity.ts'));
  }

  it('an entity file imports no entity from another slice', () => {
    const offenders: string[] = [];

    for (const file of entityFiles()) {
      const source = sliceOf(file);
      for (const specifier of importsOf(file)) {
        const target = resolveSpecifier(file, specifier);
        if (!target) continue;
        const targetSlice = sliceOf(target);
        if (!targetSlice || targetSlice === source) continue;
        if (target.includes(`${path.sep}entities${path.sep}`)) {
          offenders.push(`${relative(file)} -> ${targetSlice}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('Rule 5: one table, one schema, one class', () => {
  interface SchemaRecord {
    table: string | null;
    className: string;
    file: string;
  }

  /** Local names bound to `EntitySchema`, including `... as EntitySchema`. */
  function entitySchemaLocals(source: ts.SourceFile): Set<string> {
    const locals = new Set<string>();

    source.forEachChild((node) => {
      if (
        !ts.isImportDeclaration(node) ||
        !node.moduleSpecifier ||
        !ts.isStringLiteral(node.moduleSpecifier) ||
        node.moduleSpecifier.text !== '@mikro-orm/core'
      ) {
        return;
      }
      const bindings = node.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) return;
      for (const element of bindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text;
        if (imported === 'EntitySchema') locals.add(element.name.text);
      }
    });

    return locals;
  }

  function schemaRecords(): SchemaRecord[] {
    const records: SchemaRecord[] = [];

    for (const file of productionFiles(schemasDir)) {
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf-8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const locals = entitySchemaLocals(source);

      const visit = (node: ts.Node): void => {
        if (
          ts.isNewExpression(node) &&
          ts.isIdentifier(node.expression) &&
          locals.has(node.expression.text) &&
          node.arguments?.[0] &&
          ts.isObjectLiteralExpression(node.arguments[0])
        ) {
          let className = '';
          let table: string | null = null;

          for (const property of node.arguments[0].properties) {
            if (
              !ts.isPropertyAssignment(property) ||
              !ts.isIdentifier(property.name)
            ) {
              continue;
            }
            if (
              property.name.text === 'class' &&
              ts.isIdentifier(property.initializer)
            ) {
              className = property.initializer.text;
            }
            if (
              property.name.text === 'tableName' &&
              ts.isStringLiteral(property.initializer)
            ) {
              table = property.initializer.text;
            }
          }

          records.push({ table, className, file: relative(file) });
        }
        ts.forEachChild(node, visit);
      };

      visit(source);
    }

    return records;
  }

  function classDeclarations(): Map<string, string[]> {
    const declared = new Map<string, string[]>();

    for (const file of productionFiles(rootSrcDir)) {
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf-8'),
        ts.ScriptTarget.Latest,
        true,
      );

      const visit = (node: ts.Node): void => {
        if (ts.isClassDeclaration(node) && node.name) {
          const paths = declared.get(node.name.text) ?? [];
          paths.push(relative(file));
          declared.set(node.name.text, paths);
        }
        ts.forEachChild(node, visit);
      };

      visit(source);
    }

    return declared;
  }

  // An entity belongs to a slice, and `infrastructure` is not one.
  const entitiesPattern = new RegExp(
    `^(?:${slices.join('|')})/entities/[a-z0-9-]+\\.entity\\.ts$`,
  );

  function ownershipProblems(
    records: SchemaRecord[],
    declared: Map<string, string[]>,
  ): string[] {
    const problems: string[] = [];
    const byTable = new Map<string, string[]>();

    for (const record of records) {
      if (record.table !== null) {
        const files = byTable.get(record.table) ?? [];
        files.push(record.file);
        byTable.set(record.table, files);
      }

      const files = declared.get(record.className);
      if (!files || files.length === 0) {
        problems.push(
          `${record.className} -> not declared in any production file`,
        );
        continue;
      }
      if (files.length > 1) {
        problems.push(`${record.className} -> declared in ${files.join(', ')}`);
        continue;
      }
      if (!entitiesPattern.test(files[0])) {
        problems.push(`${record.className} -> ${files[0]}`);
      }
    }

    for (const [table, files] of byTable.entries()) {
      if (files.length > 1) {
        problems.push(`table "${table}" -> ${files.join(', ')}`);
      }
    }

    return [...new Set(problems)];
  }

  function declaredTableCount(): number {
    return (
      productionFiles(schemasDir)
        .map((file) => fs.readFileSync(file, 'utf-8'))
        .join('\n')
        .match(/tableName\s*:/g)?.length ?? 0
    );
  }

  it('every schema class owns one table and lives in its slice entities directory', () => {
    const records = schemaRecords();

    // Every `tableName:` in the mapping must have been parsed: a schema the
    // parser does not recognise would otherwise be neither owned nor checked.
    expect(records.filter((record) => record.table !== null).length).toBe(
      declaredTableCount(),
    );
    expect(ownershipProblems(records, classDeclarations())).toEqual([]);
  });

  it('reports a duplicate table and a misplaced class', () => {
    const problems = ownershipProblems(
      [
        { table: 'job', className: 'Ghost', file: 'a.schema.ts' },
        { table: 'job', className: 'Ghost', file: 'b.schema.ts' },
      ],
      new Map([['Ghost', ['sharing/models/ghost.ts']]]),
    );

    expect(problems).toEqual([
      'Ghost -> sharing/models/ghost.ts',
      'table "job" -> a.schema.ts, b.schema.ts',
    ]);
  });

  it('rejects an entity declared outside a slice', () => {
    const problems = ownershipProblems(
      [{ table: 'ghost', className: 'Ghost', file: 'ghost.schema.ts' }],
      new Map([['Ghost', ['infrastructure/entities/ghost.entity.ts']]]),
    );

    expect(problems).toEqual([
      'Ghost -> infrastructure/entities/ghost.entity.ts',
    ]);
  });
});

describe('Rule 6: entity files are plain objects', () => {
  const entityFiles = (): string[] =>
    productionFiles(rootSrcDir).filter((f) => f.endsWith('.entity.ts'));

  it('finds the entities to check', () => {
    expect(entityFiles().length).toBeGreaterThanOrEqual(9);
  });

  it('carries no decorator and imports no mapper', () => {
    const offenders: string[] = [];

    for (const file of entityFiles()) {
      const content = fs.readFileSync(file, 'utf-8');
      content.split('\n').forEach((line, index) => {
        const at = `${relative(file)}:${index + 1}`;
        // Any decorator, not a list of known ones: MikroORM maps with `@Property`,
        // `@ManyToOne` and friends, and a new one must not slip through.
        if (/^\s*@[A-Za-z_$]/.test(line)) offenders.push(`${at} decorator`);
        if (/from\s+['"]typeorm['"]/.test(line))
          offenders.push(`${at} mapper import`);
      });
    }

    expect(offenders).toEqual([]);
  });
});

describe('Rule 7: entities do not leak their internals', () => {
  let program: ts.Program;
  let entityFiles: string[];

  beforeAll(() => {
    const configPath = ts.findConfigFile(
      repoRoot,
      (f) => ts.sys.fileExists(f),
      'tsconfig.json',
    )!;
    const configFile = ts.readConfigFile(configPath, (f) => ts.sys.readFile(f));
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(configPath),
    );

    const host = {
      getScriptFileNames: () => parsed.fileNames,
      getScriptVersion: () => '1',
      getScriptSnapshot: (f: string) =>
        ts.sys.fileExists(f)
          ? ts.ScriptSnapshot.fromString(ts.sys.readFile(f)!)
          : undefined,
      getCurrentDirectory: () => path.dirname(configPath),
      getCompilationSettings: () => parsed.options,
      getDefaultLibFileName: (opts: ts.CompilerOptions) =>
        ts.getDefaultLibFilePath(opts),
      fileExists: (f: string) => ts.sys.fileExists(f),
      readFile: (f: string) => ts.sys.readFile(f),
      readDirectory: (
        dir: string,
        extensions?: readonly string[],
        excludes?: readonly string[],
        includes?: readonly string[],
        depth?: number,
      ) => ts.sys.readDirectory(dir, extensions, excludes, includes, depth),
      directoryExists: (dir: string) => ts.sys.directoryExists?.(dir) ?? false,
      getDirectories: (dir: string) => ts.sys.getDirectories(dir),
    };

    const languageService = ts.createLanguageService(
      host,
      ts.createDocumentRegistry(),
    );
    program = languageService.getProgram()!;
    entityFiles = productionFiles(rootSrcDir).filter((f) =>
      f.endsWith('.entity.ts'),
    );
  }, 30000);

  it('loads every entity into the program', () => {
    const unresolved = entityFiles.filter(
      (file) => !program.getSourceFile(file),
    );
    expect(unresolved.map(relative)).toEqual([]);
  });

  it('Date and array getters hand back no mutable references', () => {
    const leaks: string[] = [];
    const checker = program.getTypeChecker();

    for (const entityFile of entityFiles) {
      const source = program.getSourceFile(entityFile);
      if (!source) continue;

      source.forEachChild((node) => {
        if (!ts.isClassDeclaration(node) || !node.name) return;
        const className = node.name.text;

        node.members.forEach((member) => {
          if (!ts.isGetAccessor(member)) return;

          const name = member.name.getText(source);
          // An unannotated getter is the common style; skipping it would let a
          // Date leak through just by leaving the type off.
          const returnType =
            member.type?.getText(source) ??
            checker.typeToString(
              checker.getTypeOfSymbolAtLocation(
                checker.getSymbolAtLocation(member.name)!,
                member,
              ),
            );
          const body = member.body?.getText(source) ?? '';

          if (returnType.includes('Date') && !body.includes('new Date(')) {
            leaks.push(`${className}.${name} returns a Date it does not clone`);
          }

          if (
            (returnType.includes('[]') || returnType.startsWith('Array<')) &&
            !returnType.includes('readonly') &&
            !body.includes('Object.freeze') &&
            !returnType.includes('Collection')
          ) {
            leaks.push(`${className}.${name} returns a mutable array`);
          }
        });
      });
    }

    expect(leaks).toEqual([]);
  });
});

describe('Rule 8: registered schemas match injected repositories', () => {
  it('registers exactly the schemas that repositories are injected for', () => {
    const files = productionFiles(rootSrcDir);
    const registered = new Map<string, string>();
    const injected = new Map<string, string>();
    const scopeOf = (file: string): string =>
      relative(file).split('/')[0] ?? '';

    for (const file of files) {
      const relativePath = relative(file);
      const scope = scopeOf(file);
      const source = fs.readFileSync(file, 'utf-8');

      for (const match of source.matchAll(
        /MikroOrmModule\.forFeature\(\s*\[([^\]]*)\]/g,
      )) {
        for (const name of match[1]
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)) {
          registered.set(`${scope}:${name}`, relativePath);
        }
      }

      for (const match of source.matchAll(
        /@InjectRepository\(\s*([A-Za-z0-9_]+)\s*\)/g,
      )) {
        injected.set(`${scope}:${match[1]}`, relativePath);
      }
    }

    expect(registered.size).toBeGreaterThanOrEqual(8);

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

describe('Rule 9: persistence goes through the ORM', () => {
  it('production code does not open connections or write raw SQL', () => {
    const offenders: string[] = [];

    for (const file of productionFiles(rootSrcDir)) {
      const source = fs.readFileSync(file, 'utf-8');
      source.split('\n').forEach((line, index) => {
        if (/getConnection/.test(line) || /\.raw\(/.test(line)) {
          offenders.push(`${relative(file)}:${index + 1}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});

describe('Rule 10: no casts that bypass the type system', () => {
  it('production code does not use `as unknown as`', () => {
    const offenders: string[] = [];

    for (const file of productionFiles(rootSrcDir)) {
      const source = fs.readFileSync(file, 'utf-8');
      source.split('\n').forEach((line, index) => {
        if (line.includes('as unknown as')) {
          offenders.push(`${relative(file)}:${index + 1}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});

describe('One spec file per implementation file', () => {
  // A file that leaves src does not stop needing a spec.
  const sourceRoots = [
    rootSrcDir,
    path.join(repoRoot, 'reddit-fetcher', 'src'),
    path.join(repoRoot, 'voice-service', 'src'),
    path.join(repoRoot, 'media-tools'),
  ];

  /**
   * Specs whose subject is a directory or the repository rather than a single file.
   * They are the exception, and being on this list should be a decision somebody made
   * rather than a habit: a spec that could name the file it tests must name it.
   */
  const AREA_SPECS = [
    'architecture.spec.ts', // this file: the repository's shape
    'infrastructure/database/entity-mapping.spec.ts', // the ORM mapping across slices
    'infrastructure/database/schema-snapshot.spec.ts', // migrations against the schemas
    'infrastructure/database/schemas/schemas.spec.ts', // every schema in the directory
  ];

  function specFiles(dir: string): string[] {
    const found: string[] = [];
    if (!fs.existsSync(dir)) return found;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...specFiles(fullPath));
      else if (entry.name.endsWith('.spec.ts')) found.push(fullPath);
    }
    return found;
  }

  it('keeps every suite named after the file it tests', () => {
    const orphans: string[] = [];

    for (const root of sourceRoots) {
      for (const spec of specFiles(root)) {
        const relativePath = path
          .relative(root, spec)
          .split(path.sep)
          .join('/');
        if (AREA_SPECS.includes(relativePath)) continue;

        const implementation = spec.replace(/\.spec\.ts$/, '.ts');
        if (!fs.existsSync(implementation)) {
          // A suite named after an aspect ("outline", "watchdog-lock") outlives the
          // file it describes and quietly becomes a second home for one file's tests.
          orphans.push(relativePath);
        }
      }
    }

    expect(orphans).toEqual([]);
  });
});
