# Social Radio — Multi-Channel Liquidsoap Stream Source
# Dynamic playlist stream with listener-aware idle conservation

# Log level
set("log.level", 3)

# Server settings
icecast_host    = environment.get(default="icecast", "ICECAST_HOST")
icecast_port    = int_of_string(environment.get(default="8000", "ICECAST_PORT"))
icecast_pass    = environment.get(default="hackme", "ICECAST_PASSWORD")
backend_url     = environment.get(default="http://app:3000", "BACKEND_URL")
storage_url     = environment.get(default="http://minio:9000/socialradio-media", "STORAGE_PUBLIC_URL")
internal_secret = environment.get(default="secret", "INTERNAL_SERVICE_SECRET")
idle_sec        = float_of_string(environment.get(default="600.0", "IDLE_THRESHOLD_SECONDS"))

# Dynamic Track Request Function (Backend Queue)
def get_next_track(channel_id) =
  uri = "#{backend_url}/channels/#{channel_id}/next-track"
  try
    response = http.get(headers=[("x-internal-token", internal_secret)], uri)
    if string.contains(substring="\"filePath\":\"", response) then
      parts = string.split(separator="\"filePath\":\"", response)
      rest = list.nth(default="", parts, 1)
      subparts = string.split(separator="\"", rest)
      file_path = list.nth(default="", subparts, 0)
      if file_path == "" then
        null()
      else
        full_url = if string.contains(prefix="http://", file_path) or string.contains(prefix="https://", file_path) then
          file_path
        else
          "#{storage_url}/#{file_path}"
        end
        print("Channel #{channel_id} fetched next track: #{full_url}")
        request.create(full_url)
      end
    else
      null()
    end
  catch e do
    print("Error fetching next track for channel #{channel_id}: #{e}")
    null()
  end
end

# Track active mounted channels to prevent duplicate mounts
mounted_channels = ref([])

# Channel Stream Factory with Listener-Aware Idle Conservation
def create_channel_stream(channel_id) =
  if list.mem(channel_id, mounted_channels()) then
    ()
  else
    mounted_channels := list.add(channel_id, mounted_channels())
    print("Creating broadcast stream for channel: #{channel_id}")

    # State tracking
    is_idle = ref(false)
    zero_listeners_since = ref(-1.0)

    # Check listener count periodically from Icecast
    def check_listeners() =
      stats_uri = "http://#{icecast_host}:#{icecast_port}/admin/stats"
      auth_header = "Basic " ^ string.base64.encode("admin:#{icecast_pass}")
      try
        stats_resp = http.get(headers=[("Authorization", auth_header)], stats_uri)
        mount_str = "/channels/#{channel_id}.mp3"
        if string.contains(substring="<listeners>0</listeners>", stats_resp) or not string.contains(substring=mount_str, stats_resp) then
          if zero_listeners_since() < 0.0 then
            zero_listeners_since := time()
          elsif time() - zero_listeners_since() >= idle_sec then
            if not is_idle() then
              print("Channel #{channel_id} entered idle state (0 listeners > #{idle_sec}s). Pausing generation.")
              is_idle := true
            end
          end
        else
          zero_listeners_since := -1.0
          if not is_idle() then
            print("Channel #{channel_id} active: listener connected. Resuming stream.")
            is_idle := false
          end
        end
      catch _ do
        ()
      end
    end

    # Run listener check every 10 seconds
    thread.run(every=10.0, check_listeners)

    # Dynamic track supplier: pauses backend requests when idle
    def dynamic_track_supplier() =
      if is_idle() then
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
end

# Dynamic Channel Synchronizer: polls backend for active channels
def sync_active_channels() =
  uri = "#{backend_url}/channels/active"
  try
    response = http.get(headers=[("x-internal-token", internal_secret)], uri)
    parts = string.split(separator="\"id\":\"", response)
    list.iter(fun (part) -> begin
      subparts = string.split(separator="\"", part)
      if list.length(subparts) > 1 then
        chan_id = list.nth(default="", subparts, 0)
        if chan_id != "[" and chan_id != "" then
          create_channel_stream(chan_id)
        end
      end
    end, parts)
  catch e do
    print("Error syncing active channels: #{e}")
  end
end

# Check active channels on boot and poll periodically every 5s
thread.run(every=5.0, sync_active_channels)

# Standby keepalive output so daemon stays running before first channel is mounted
output.dummy(blank())


