var lastfm_api_url = "https://ws.audioscrobbler.com/2.0/?format=json&method=";
var lastfm_api_key = "";
var mb_api_url = "https://musicbrainz.org/ws/2/";
var from_time = new Date("01 January, 2018").getTime() * 0.001;

// artist, album, track
var lastfm_artists = {};
var lastfm_tracks = [];
var lastfm_total_time = 0;
var lastfm_trackinfo_counter = 0;
var lastfm_scrobbles_loaded = false;
var lastfm_top_artists = [];
var mb_api_request_counter = 0;

var track_info_cache = JSON.parse(localStorage.getItem("lasttime.track_info_cache"));
if(track_info_cache === null)
    track_info_cache = {};
var missed_tracks = [];

var $progress_info = $("#progress-info");
var $progress_bar = $(".progress-bar");

function lastfm_api_request(method, params) {
    var url = lastfm_api_url + method + "&api_key=" + lastfm_api_key;
    for (const key in params) {
        if (params.hasOwnProperty(key))
            url += "&" + key + "=" + params[key];
    }
    return $.getJSON(url);
}

function mb_api_lookup(entity, mbid) {
    var url = mb_api_url + entity + "/" + mbid + "?fmt=json";
    return $.getJSON(url);
}

function mb_api_query(entity, search_fields) {
    var url = mb_api_url + entity + "/" + "?fmt=json&query=";
    var first = true;
    for (const key in search_fields) {
        if (search_fields.hasOwnProperty(key)) {
            if (!first)
                url += " AND ";
            else
                first = false;
            url += key + ":" + search_fields[key];
        }
    }
    return $.getJSON(url);
}

function lastfm_api_request(method, params) {
    var url = lastfm_api_url + method + "&api_key=" + lastfm_api_key;
    for (const key in params) {
        if (params.hasOwnProperty(key))
            url += "&" + key + "=" + params[key];
    }
    return $.getJSON(url);
}

function on_track_get_info(duration, info_index) {
    lastfm_tracks[info_index].duration = duration;
    if (lastfm_scrobbles_loaded) {
        let tracks_loaded = lastfm_tracks.length - lastfm_trackinfo_counter;
        $progress_bar.attr("aria-valuenow", tracks_loaded).width(tracks_loaded * 100 / lastfm_tracks.length + "%");
        $progress_info.text("Retrieving track info... " + tracks_loaded + " / " + lastfm_tracks.length);
    }
    if (--lastfm_trackinfo_counter == 0 && lastfm_scrobbles_loaded)
        lastfm_on_all_data();
}

function lastfm_on_all_data() {
    $progress_info.text("Collating data...");

    lastfm_top_artists = [];

    for (const artist_key in lastfm_artists) { // collate artists
        if (!lastfm_artists.hasOwnProperty(artist_key))
            continue;

        let artist_data = lastfm_artists[artist_key];
        for (const album_key in artist_data.albums) { // collate albums
            if (!artist_data.albums.hasOwnProperty(album_key))
                continue;

            let album_data = artist_data.albums[album_key];
            for (const track_key in album_data.tracks) { // collate tracks
                if (!album_data.tracks.hasOwnProperty(track_key))
                    continue;

                let track_data = album_data.tracks[track_key];
                track_data.total_time = lastfm_tracks[track_data.info_index].duration * track_data.count;
                album_data.total_time += track_data.total_time;
            }

            artist_data.total_time += album_data.total_time;
        }

        lastfm_top_artists.push({ name: artist_data.name, duration: artist_data.total_time });
        lastfm_total_time += artist_data.total_time;
    }

    lastfm_top_artists.sort(function(a, b) { return b.duration - a.duration; });

    $progress_info.text("Done!");

    setTimeout(function() {
        $(".progress").collapse("hide");
        $progress_info.collapse("hide");
    }, 2000);

    console.log(lastfm_artists);
    console.log(Math.floor(lastfm_total_time / 60000) + " mins");

    $("#minutes-listened").text(Math.floor(lastfm_total_time / 60000).toLocaleString());
    $("#hours-listened").text(Math.floor(lastfm_total_time / 3600000).toLocaleString());

    var $top_artists_list = $("#top-artists .top-list");
    $top_artists_list.empty();

    let max = Math.min(10, lastfm_top_artists.length);
    for (let i = 0; i < max; i++) {
        const elem = lastfm_top_artists[i];
        $top_artists_list.append("<div class='list-item'>" + elem.name + " <span>" + Math.floor(elem.duration / 60000).toLocaleString() + " mins</span></div>");
    }

    $("#statistics").collapse();
}

function retrieve_track_info(artist_data, album_data, track_data) {
    var artist_id = artist_data.mbid === "" ? artist_data.name : artist_data.mbid;
    var album_id = album_data.mbid === "" ? album_data.name : album_data.mbid;
    var track_id = track_data.mbid === "" ? track_data.name : track_data.mbid;
    var cache_id = artist_id + "#" + album_id + "#" + track_id;
    var info_index = track_data.info_index;
    
    if(track_info_cache.hasOwnProperty(cache_id))
    {
        let cached_track_data = track_info_cache[cache_id];
        if(cached_track_data.hasOwnProperty("duration"))
        {
            if(cached_track_data.duration === 0 || cached_track_data.is_missed_track === true)
                missed_tracks.push(cache_id);

            console.log("from cache: ", cached_track_data);
            on_track_get_info(cached_track_data.duration, info_index);
            return;
        }
    }
    track_info_cache[cache_id] = {};

    if (track_data.mbid === "") {
        setTimeout(function () {
            mb_api_query("recording", { recording: track_data.name, artist: artist_data.name, release: album_data.name }).done(function (data) {
                data = data.count ? data.recordings[0] : null;
                if (data === null || !data.hasOwnProperty("length")) {
                    // no length data, try last.fm data.
                    lastfm_api_request("track.getinfo", { artist: artist_data.name, track: track_data.name }).done(function (data) {
                        data = data.track;
                        console.log("from last.fm: ", data);

                        let dur = parseInt(data.duration);
                        if(dur === 0) {
                            track_info_cache[cache_id].is_missed_track = true;
                            missed_tracks.push(cache_id);
                        }

                        track_info_cache[cache_id].duration = dur;
                        localStorage["lasttime.track_info_cache"] = JSON.stringify(track_info_cache);
                        on_track_get_info(dur, info_index);
                    });
                }
                else
                {
                    console.log("from musicbrainz: ", data);
                    track_info_cache[cache_id].duration = data.length;
                    localStorage["lasttime.track_info_cache"] = JSON.stringify(track_info_cache);
                    on_track_get_info(data.length, info_index);
                }
            });
        }, mb_api_request_counter * 1000); // 1s delay before each call
    }
    else {
        setTimeout(function () {
            mb_api_lookup("recording", track_data.mbid).done(function (data) {
                if (data === null || !data.hasOwnProperty("length")) {
                    // no length data, try last.fm data.
                    lastfm_api_request("track.getinfo", { mbid: track_data.mbid }).done(function (data) {
                        data = data.track;
                        console.log("from last.fm: ", data);

                        let dur = parseInt(data.duration);
                        if(dur === 0) {
                            track_info_cache[cache_id].is_missed_track = true;
                            missed_tracks.push(cache_id);
                        }

                        track_info_cache[cache_id].duration = dur;
                        localStorage["lasttime.track_info_cache"] = JSON.stringify(track_info_cache);
                        on_track_get_info(dur, info_index);
                    });
                }
                else
                {
                    console.log("from musicbrainz: ", data);
                    track_info_cache[cache_id].duration = data.length;
                    localStorage["lasttime.track_info_cache"] = JSON.stringify(track_info_cache);
                    on_track_get_info(data.length, info_index);
                }
            });
        }, mb_api_request_counter * 1000); // 1s delay before each call
    }

    ++mb_api_request_counter;
}

function lastfm_on_recent_tracks(data) {
    data = data.recenttracks;
    var attr = data["@attr"];
    var tracks = data.track;
    var curr_page = parseInt(attr.page);
    var total_pages = parseInt(attr.totalPages);

    console.log(curr_page + " / " + total_pages);

    for (track of tracks) {
        let artist_id = track.artist.mbid === "" ? track.artist["#text"] : track.artist.mbid;
        let album_id = track.album.mbid === "" ? track.album["#text"] : track.album.mbid;
        let track_id = track.mbid === "" ? track.name : track.mbid;

        if (!lastfm_artists.hasOwnProperty(artist_id)) {
            let artist_data = lastfm_artists[artist_id] = {};
            artist_data.name = track.artist["#text"];
            artist_data.mbid = track.artist.mbid;
            artist_data.count = 0;
            artist_data.total_time = 0;
            artist_data.albums = {};
        }

        let artist_data = lastfm_artists[artist_id];
        ++artist_data.count;
        if (!artist_data.albums.hasOwnProperty(album_id)) {
            let album_data = artist_data.albums[album_id] = {};
            album_data.name = track.album["#text"];
            album_data.mbid = track.album.mbid;
            album_data.count = 0;
            album_data.total_time = 0;
            album_data.tracks = {};
        }

        let album_data = artist_data.albums[album_id];
        ++album_data.count;

        if (!album_data.tracks.hasOwnProperty(track_id)) {
            let track_data = album_data.tracks[track_id] = {};
            track_data.name = track.name;
            track_data.mbid = track.mbid;
            track_data.count = 0;
            track_data.total_time = 0;
            track_data.duration = 0;

            var info_index = lastfm_tracks.length;
            track_data.info_index = info_index;

            lastfm_tracks.push({});
            ++lastfm_trackinfo_counter;

            retrieve_track_info(artist_data, album_data, track_data);
        }

        let track_data = album_data.tracks[track_id];
        ++track_data.count;
    }

    if (curr_page == 1)
        $progress_bar.attr("aria-valuemax", total_pages);
    $progress_bar.attr("aria-valuenow", curr_page).width(curr_page * 100 / total_pages + "%");
    $progress_info.text("Loading scrobbles... " + curr_page + " / " + total_pages);
    if (curr_page < total_pages)
        lastfm_api_request("user.getrecenttracks", { user: "undefinist", from: from_time, limit: 200, page: curr_page + 1 }).done(lastfm_on_recent_tracks);
    else {
        let tracks_loaded = lastfm_tracks.length - lastfm_trackinfo_counter;
        $progress_bar.attr({ "aria-valuemax": lastfm_tracks.length, "aria-valuenow": tracks_loaded })
            .width(tracks_loaded * 100 / lastfm_tracks.length + "%");
        $progress_info.text("Retrieving track info... " + tracks_loaded + " / " + lastfm_tracks.length);
        lastfm_scrobbles_loaded = true;

        // if somehow all tracks loaded before pages loaded... probably due to cache.
        if (lastfm_trackinfo_counter == 0)
            lastfm_on_all_data();
    }
}

$("#run-form").on("submit", function(e) {
    e.preventDefault();
    if(this.checkValidity() === false)
    {
        this.classList.add('was-validated');
        return;
    }

    mb_api_request_counter = 0;

    var $from_date = $("#date-from-input");
    if($from_date.val())
        from_time = new Date($from_date.val()).getTime() * 0.001;

    $(".progress").collapse("show");
    $progress_info.collapse("show");
    $(this).collapse("hide");

    lastfm_api_key = $("#api-key-input").val();
    lastfm_api_request("user.getrecenttracks", { user: "undefinist", from: from_time, limit: 200 }).done(lastfm_on_recent_tracks);
});
