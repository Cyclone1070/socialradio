import {
  ScriptContract,
  VoiceContract,
  SegmentContract,
  ContentContract,
  ChannelContract,
} from './contracts';

describe('Domain Contracts', () => {
  it('should define abstract contract symbols', () => {
    expect(ScriptContract).toBeDefined();
    expect(VoiceContract).toBeDefined();
    expect(SegmentContract).toBeDefined();
    expect(ContentContract).toBeDefined();
    expect(ChannelContract).toBeDefined();
  });
});
