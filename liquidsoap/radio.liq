# Social Radio — Multi-Channel Liquidsoap Stream Source
# Continuously fetches next tracks from NestJS backend and streams 128kbps MP3 to Icecast

# Log level
set("log.level", 3)

# Server settings
icecast_host    = environment.get(default="icecast", "ICECAST_HOST")
icecast_port    = int_of_string(environment.get(default="8000", "ICECAST_PORT"))
icecast_pass    = environment.get(default="hackme", "ICECAST_PASSWORD")
backend_url     = environment.get(default="http://backend:3000", "BACKEND_URL")
internal_secret = environment.get(default="secret", "INTERNAL_SERVICE_SECRET")

# Dynamic Track Request Function
def get_next_track(channel_id) =
  uri = "#{backend_url}/channels/#{channel_id}/next-track"
  response = http.get(headers=[("X-Internal-Token", internal_secret)], uri)
  json_data = json.parse(response)
  file_path = json_data["filePath"]
  start_offset = json_data["startOffsetSeconds"]
  
  # Return track request with start offset and ICY metadata if available
  request.create(file_path)
end

# Channel Stream Factory
def create_channel_stream(channel_id) =
  # Dynamic track playlist source
  source = request.dynamic({ get_next_track(channel_id) })
  
  # Fallback safety (silence/jingle loop if source stalls)
  source = mksafe(source)

  # Output continuous 128 kbps MP3 stream to Icecast mount point
  output.icecast(%mp3(bitrate=128),
    host=icecast_host,
    port=icecast_port,
    password=icecast_pass,
    mount="/channels/#{channel_id}.mp3",
    name="Social Radio — Channel #{channel_id}",
    description="Community AI Radio Stream",
    genre="Talk / Social",
    url="http://socialradio.com",
    source
  )
end

# Discover and start all active channels
default_channel_id = environment.get(default="main", "DEFAULT_CHANNEL_ID")
create_channel_stream(default_channel_id)
