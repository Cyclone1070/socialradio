# Social Radio — Multi-Channel Liquidsoap Stream Source
# Dynamic playlist stream with 10-minute listener-aware idle conservation

# Log level
set("log.level", 3)

# Server settings
icecast_host    = environment.get(default="icecast", "ICECAST_HOST")
icecast_port    = int_of_string(environment.get(default="8000", "ICECAST_PORT"))
icecast_pass    = environment.get(default="hackme", "ICECAST_PASSWORD")
backend_url     = environment.get(default="http://backend:3000", "BACKEND_URL")
internal_secret = environment.get(default="secret", "INTERNAL_SERVICE_SECRET")
idle_sec        = float_of_string(environment.get(default="600.0", "IDLE_THRESHOLD_SECONDS"))

# Dynamic Track Request Function (Backend Queue)
def get_next_track(channel_id) =
  uri = "#{backend_url}/channels/#{channel_id}/next-track"
  response = http.get(headers=[("X-Internal-Token", internal_secret)], uri)
  json_data = json.parse(response)
  file_path = json_data["filePath"]
  request.create(file_path)
end

# Channel Stream Factory with 10-Minute Idle Conservation
def create_channel_stream(channel_id) =
  # State tracking
  is_idle = ref(false)
  zero_listeners_since = ref(-1.0)

  # Check listener count periodically from Icecast
  def check_listeners() =
    stats_uri = "http://#{icecast_host}:#{icecast_port}/admin/stats"
    auth_header = "Basic " ^ string.base64("admin:#{icecast_pass}")
    try
      stats_resp = http.get(headers=[("Authorization", auth_header)], stats_uri)
      mount_str = "/channels/#{channel_id}.mp3"
      if string.contains(substring="<listeners>0</listeners>", stats_resp) or not string.contains(substring=mount_str, stats_resp) then
        if !zero_listeners_since < 0.0 then
          zero_listeners_since := time()
        elsif time() - !zero_listeners_since >= idle_sec then
          if not !is_idle then
            print("Channel #{channel_id} entered idle state (0 listeners > #{idle_sec}s). Pausing generation.")
            is_idle := true
          end
        end
      else
        zero_listeners_since := -1.0
        if !is_idle then
          print("Channel #{channel_id} active: listener connected. Resuming stream.")
          is_idle := false
        end
      end
    catch _ do
      ()
    end
  end

  # Run listener check every 30 seconds
  thread.run(every=30.0, check_listeners)

  # Dynamic track supplier: pauses backend requests when idle
  def dynamic_track_supplier() =
    if !is_idle then
      null()
    else
      get_next_track(channel_id)
    end
  end

  # Dynamic track playlist source
  source = request.dynamic(dynamic_track_supplier)
  
  # Fallback safety (silence standby if idle or queue resolving)
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
