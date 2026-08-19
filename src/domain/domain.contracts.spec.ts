import { ScriptContract, VoiceContract, ContentContract } from './contracts';

describe('Domain Contracts', () => {
  it('should define abstract contract symbols', () => {
    expect(ScriptContract).toBeDefined();
    expect(VoiceContract).toBeDefined();
    expect(ContentContract).toBeDefined();
  });
});
