export class User {
  id!: string;
  email!: string;
  passwordHash!: string;
  role: string = 'user';
  createdAt: Date = new Date();
}
