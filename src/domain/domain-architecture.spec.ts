import * as fs from 'fs';
import * as path from 'path';

describe('Domain Architecture Guardrails', () => {
  const domainDir = path.join(__dirname, '../domain');

  function getAllTsFiles(dir: string): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getAllTsFiles(fullPath));
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

  it('domain/ must not contain TypeORM entities or NestJS decorators', () => {
    const files = getAllTsFiles(domainDir);
    const forbiddenPatterns = [
      /@Entity\s*\(/,
      /@Injectable\s*\(/,
      /@Module\s*\(/,
      /@Controller\s*\(/,
      /from\s+['"]typeorm['"]/,
      /from\s+['"]@nestjs\/typeorm['"]/,
    ];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      for (const pattern of forbiddenPatterns) {
        expect(content).not.toMatch(pattern);
      }
    }
  });

  it('domain/ types must be pure TypeScript interfaces or abstract class tokens', () => {
    const files = getAllTsFiles(domainDir);

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content
        .split('\n')
        .filter((l) => l.trim().startsWith('export '));

      for (const line of lines) {
        const isInterface = line.includes('export interface ');
        const isAbstractClass = line.includes('export abstract class ');
        const isType = line.includes('export type ');
        const isReexport = line.includes('export * from');
        const isConst = line.includes('export const ');
        expect(
          isInterface || isAbstractClass || isType || isReexport || isConst,
        ).toBe(true);
      }
    }
  });
});
