import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ConfigureChannelDto } from './configure-channel.dto';

describe('ConfigureChannelDto', () => {
  it('accepts valid name and trims whitespace', async () => {
    const dto = plainToInstance(ConfigureChannelDto, {
      name: '  Synthwave Station  ',
      visibility: 'public',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.name).toBe('Synthwave Station');
  });

  it('rejects empty or whitespace-only name', async () => {
    const dto = plainToInstance(ConfigureChannelDto, {
      name: '    ',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('name');
  });

  it('rejects invalid visibility value', async () => {
    const dto = plainToInstance(ConfigureChannelDto, {
      name: 'Valid Name',
      visibility: 'confidential',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('visibility');
  });
});
