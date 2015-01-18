
var NowPlayingDefaults = {};

// Version
NowPlayingDefaults.Version = "0.1";
NowPlayingDefaults.Id = "predatumNP_for_amarok_2";
NowPlayingDefaults.RemoteAppBase = "http://192.168.2.40";
NowPlayingDefaults.RemoteAppBasePort = 2014;

NowPlayingDefaults.ShowDebug = true;
// Beta function:
NowPlayingDefaults.EnableBetaFeatures = false;

// Proxy
NowPlayingDefaults.Proxy = {
    "enabled": false,
    "host": "example.com",
    "port": "8080",
    "user": "johndoe",
    "password": "pred"
};
//dependencies
Importer.loadQtBinding("qt.core");
Importer.loadQtBinding("qt.gui");
Importer.loadQtBinding("qt.network");
Importer.loadQtBinding("qt.uitools");

Importer.include("moment.js")
Importer.include("lame_info.js")


//globar vars	
var ratingPostData = {};
var currentSongDataFromServer = {};
var cookieHeader = null;
var loginAttempts = 0;
var previousStatus = 2;
var previousSong = "";

/* POST network requests handling class
 */
var DataPOSTer = {
    /* Posts data to url
     * @param data (object) associative object of {key1: "value1", key2: "value2"...}
     * @param HTTPParams (object) associative object of {key1: "value1", key2: "value2"...}
     * @return (QHttp*) modified QHttp object
     */
    simple: function (url, data, HTTPParams) {
        // Do normal POST
        var postRequest = new QHttpRequestHeader();
        if (HTTPParams) {
            for (var i in HTTPParams) {
                postRequest.setValue(i, HTTPParams[i]);
            }
        }
        postRequest.setRequest("POST", url.encodedPath().toString(), 1, 1);
        postRequest.setValue("Host", url.encodedHost().toString());
        postRequest.setContentType("application/x-www-form-urlencoded");

        var postDataByteArray = new QByteArray();
        var first = true;
        for (var i in data) {
            if (!first) {
                postDataByteArray.append("&");
            } else {
                first = false;
            }
            postDataByteArray.append(i + "=" + QUrl.toPercentEncoding(data[i]));
        }

        postRequest.setContentLength(postDataByteArray.length());

        return DataPOSTer.getCustomQHttp(url, postDataByteArray, postRequest);
    },
    getCustomQHttp: function (url, byteArrayData, requestHeader) {
        var http = new QHttp();
        if (NowPlaying.Proxy.enabled) {
            var proxy = new QNetworkProxy();
            proxy.setType(QNetworkProxy.HttpProxy);
            proxy.setHostName(NowPlaying.Proxy.host);
            proxy.setPort(NowPlaying.Proxy.port);
            proxy.setUser(NowPlaying.Proxy.user);
            proxy.setPassword(NowPlaying.Proxy.password);
            http.setProxy(proxy);
        }
        http.setHost(url.encodedHost(), null, NowPlaying.RemoteAppBasePort);
        http.requestHeader = requestHeader;
        http.data = byteArrayData;
        return http;
    }
};

/* Sends track data to remote server.
 */
function sendData(data, cookieHeader) {
    try {

        var url = new QUrl(NowPlaying.RemoteAppBase + "/api/scrobbler");
        var HTTPParams = {"User-Agent": "PredatumNP here"};
        HTTPParams['Cookie'] = cookieHeader;

        var http = DataPOSTer.simple(url, data, HTTPParams);

        http.param = data.param;
        http.errorFlag = false;
        http.done.connect(http, "nowPlayingProcessReply");
        http.go();
    } catch (err) {
        debugException(err);
    }
}

/* authenticates user in server.
 */
function authenticateToPredatum() {
    try {
        var url = new QUrl(NowPlaying.RemoteAppBase + '/api/user/authenticate');
        var HTTPParams = {"User-Agent": "PredatumNP here"};


        var data = {};
        data.email = NowPlaying.UserName;
        data.password = NowPlaying.UserPassword;
        data.remember = '1';

        debugMessage("authenticating with user / pass: " + NowPlaying.UserName + " / " + NowPlaying.UserPassword, "DataPOSTer");
        var http = DataPOSTer.simple(url, data, HTTPParams);

        //http.param = data.param;
        http.errorFlag = false;
        http.done.connect(http, "processLoginReply");
        http.go();
    } catch (err) {
        debugException(err);
    }
}

/* Process authentication and send track data.
 */
QHttp.prototype.processLoginReply = function () {
    try {

        var rawReplyData = this.readAll().toString();
        debugMessage(rawReplyData, "QHttp.prototype.processLoginReply");

        var replyData = parseJSON(rawReplyData);

        if (!replyData.error) {
            var response = this.lastResponse().toString();
            var cookieHeader = response.match(/laravel_session=[^;]+/)[0];
            if (response.search('cartalyst_sentry')) {
                cookieHeader = cookieHeader + "; " + response.match(/cartalyst_sentry=[^;]+/)[0]
            }

        }
        else {
            Amarok.alert("Login failed: " + replyData.error[1]);
            return false;
        }

        Amarok.Script.writeConfig("cookie", cookieHeader);
        debugMessage(cookieHeader, "QHttp.prototype.processLoginReply");

        sendData(fetchTrackData(), cookieHeader);

    } catch (err) {
        debugException(err, "function QHttp.prototype.processLoginReply");
    }
};

/* Gets status codes and such from a network request
 */
QHttp.prototype.nowPlayingProcessReply = function (error) {
    try {

        if (!error) {

            var rawReplyData = this.readAll().toString();

            debugMessage(rawReplyData, "QHttp.prototype.nowPlayingProcessReply");

            var replyData = parseJSON(rawReplyData);

            var replyData = parseJSON(rawReplyData);

            if (replyData.error) {
                if (replyData.error[0] == "login_error" && loginAttempts < 3) {//cookie not valid anymore?
                    authenticateToPredatum();
                    loginAttempts++;
                }
                else {
                    showMessage(qsTr("PredatumNP - Error while posting to server:" + replyData.error[1]));
                }
            }
            //data successfully processed by server
            else {
                //song data succesfully posted, keep song data returned from server		
                if (replyData.np_data)
                    currentSongDataFromServer = replyData.np_data;
                //music rated or playing status changed, show status bar message
                else if (replyData.status_response) {
                    Amarok.Window.Statusbar.shortMessage(qsTr("Predatum: " + replyData.status_response[1]));
                }
                //something went wrong
                else {
                    Amarok.alert(rawReplyData)
                }
            }

            // if ( this.param == "update" )
            // timer.start(1000 * 60 * 10); // 10 minutes


        }

    } catch (err) {
        debugException(err, "function QHttp.prototype.nowPlayingProcessReply");
    }
};

QHttp.prototype.go = function () {
    try {
        if (this.requestHeader && this.data) {
            this.request(this.requestHeader, this.data);
        }
    } catch (err) {
        debugException(err, "function QHttp.prototype.go");
    }
};

/* Checks if a new version of this script is available
 */
function checkUpdate() {
    try {
        if (Amarok.Script.readConfig("useNowPlaying", "true") == "true") {
            var data = {};
            data.param = "update";
            data.player = "Amarok";
            data.player_version = Amarok.Info.version();
            data.script = NowPlaying.Id;
            data.script_version = NowPlaying.Version;
            sendData(data, null);
        }
    } catch (err) {
        debugException(err, "function checkUpdate");
    }
}

/* Gets from Amarok and playing file all needed information, and puts
 * everything in an object.
 */
function fetchTrackData() {
    try {
        if (Amarok.Engine.engineState() == 2) {
            // Amarok is on "stop"
            return false;
        }
        var data = {};

        data.action = 'play';
        var f = new QFileInfo(Amarok.Engine.currentTrack().path);
        data.file_name = f.fileName();
        data.file_size = f.size();
        data.folder_name = f.canonicalPath()
        var d = moment(f.created().toString());
        data.file_date = d.format('YYYY-MM-DD H:mm:ss');
        data.file_type = f.suffix().toUpperCase();
        data.track = Amarok.Engine.currentTrack().trackNumber;
        data.title = Amarok.Engine.currentTrack().title;
        data.artist = Amarok.Engine.currentTrack().artist;
        data.album = Amarok.Engine.currentTrack().album;
        data.score = Amarok.Engine.currentTrack().score;
        data.rating = Amarok.Engine.currentTrack().rating;
        data.counter = Amarok.Engine.currentTrack().playCount;
        data.genre = Amarok.Engine.currentTrack().genre;
        data.duration = (Amarok.Engine.currentTrack().length / 1000);
        data.year = Amarok.Engine.currentTrack().year;
        data.bitrate = Amarok.Engine.currentTrack().bitrate;
        data.comment = Amarok.Engine.currentTrack().comment;
        var now = moment(Date());
        data.start_time = now.format('YYYY-MM-DD H:mm:ss');
        if (getPreset() != null) {
            data.lame_encoded = 1;
            data.quality = getPreset();
        } else {
            data.lame_encoded = 0;
            data.quality = null;
        }
        if (data.filetype == 'FLAC') {
            data.quality = 'lossless';
        }
        return data;
    } catch (err) {
        debugException(err, "function fetchTrackData");
    }
}

/* returns a json object from a string */
function parseJSON(str) {
    try {
        return JSON.parse(str, function (key, value) {
            var type;
            if (value && typeof value === 'object') {
                type = value.type;
                if (typeof type === 'string' && typeof window[type] === 'function') {
                    return new (window[type])(value);
                }
            }
            return value;
        });
    } catch (err) {
        debugException(err, "function parseJSON");
    }
}


/* Called on 'comment' post event
 */
function commentPostEventHandler() {
    try {

        if (!isEmpty(currentSongDataFromServer)) {
            var data = fetchTrackData();
            ratingPostData.action = "np_rating";

            // Add info to SongInfo label
            commentPostDialog.frame_SongInfo.label_SongInfo.setText(
                    "<strong>%TITLE%</strong> by <strong>%ARTIST%</strong> on <em>%ALBUM%</em>"
                    .replace(/%TITLE%/g, data.title)
                    .replace(/%ARTIST%/g, data.artist)
                    .replace(/%ALBUM%/g, data.album)

                    );
            //set spin boxes values from server data
            commentPostDialog.rateThisAlbum.setValue(currentSongDataFromServer.user_release_rating);
            commentPostDialog.rateThisSong.setValue(currentSongDataFromServer.user_track_rating);
            //set review text from server data
			var albumReviewText = currentSongDataFromServer.user_release_review;
			if(albumReviewText === null) {
				albumReviewText = '';
			}				
			var songReviewText = currentSongDataFromServer.user_track_review;
			if(songReviewText === null) {
				songReviewText = '';
			}		
			commentPostDialog.reviewThisAlbum.setText(qsTr(albumReviewText));
			commentPostDialog.reviewThisSong.setText(qsTr(songReviewText))			
        }
        else {
            commentPostDialog.frame_SongInfo.label_SongInfo.setText(
                    qsTr("No music to comment on!"));
        }

        commentPostDialog.rateThisAlbumLabel.setEnabled(!isEmpty(currentSongDataFromServer));
        commentPostDialog.rateThisAlbum.setEnabled(!isEmpty(currentSongDataFromServer));
        commentPostDialog.rateThisSongLabel.setEnabled(!isEmpty(currentSongDataFromServer));
        commentPostDialog.rateThisSong.setEnabled(!isEmpty(currentSongDataFromServer));
        commentPostDialog.reviewThisAlbumLabel.setEnabled(!isEmpty(currentSongDataFromServer));
        commentPostDialog.reviewThisAlbum.setEnabled(!isEmpty(currentSongDataFromServer));
        commentPostDialog.reviewThisSongLabel.setEnabled(!isEmpty(currentSongDataFromServer));
        commentPostDialog.reviewThisSong.setEnabled(!isEmpty(currentSongDataFromServer));

        // Reset fields in commentPostDialog
        // commentPostDialog.rateThisAlbum.clear();
        // commentPostDialog.reviewThisAlbum.setText("");

        // TODO reset previews

        commentPostDialog.show();
    } catch (err) {
        debugException(err, "function commentPostEventHandler");
    }
}

/* Called when commentPostDialog is accepted
 */
function processCommentPost() {
    try {

        if (!isEmpty(currentSongDataFromServer)) {

            ratingPostData.user_track_id = currentSongDataFromServer.user_track;
            ratingPostData.album_rating = commentPostDialog.rateThisAlbum.value;
            ratingPostData.album_review = commentPostDialog.reviewThisAlbum.plainText;
            ratingPostData.song_rating = commentPostDialog.rateThisSong.value;
            ratingPostData.song_review = commentPostDialog.reviewThisSong.plainText;

            // TODO fetch data from dialog about which handlers to use
            sendData(ratingPostData, cookieHeader);
        }
    } catch (err) {
        debugException(err, "function processCommentPost");
    }
}


/* Puts configuration in the NowPlaying object.
 */
function readConfig() {
    try {
        with (Amarok.Script) {
            NowPlaying.UseNowPlaying = (readConfig("useNowPlaying", "true") == "true");

            NowPlaying.UserName = readConfig("userName", "") + "";
            NowPlaying.UserPassword = readConfig("userPassword", "") + "";

            NowPlaying.RemoteAppBase = readConfig("remoteAppBase", NowPlayingDefaults.RemoteAppBase + "") + "";
            NowPlaying.RemoteAppBase.port =
                    readConfig("remoteAppBasePort", "" + NowPlayingDefaults.RemoteAppBasePort) - 0;
            NowPlaying.ShowDebug = (readConfig("showDebug", NowPlayingDefaults.ShowDebug + "") == "true");
            NowPlaying.EnableBetaFeatures = (readConfig("enableBetaFeatures", NowPlayingDefaults.EnableBetaFeatures + "") == "true");

            NowPlaying.Proxy = {};
            NowPlaying.Proxy.enabled =
                    (readConfig("proxyEnabled", "" + NowPlayingDefaults.Proxy.enabled) == "true");
            NowPlaying.Proxy.host =
                    "" + readConfig("proxyHost", "" + NowPlayingDefaults.Proxy.host);
            NowPlaying.Proxy.port =
                    readConfig("proxyPort", "" + NowPlayingDefaults.Proxy.port) - 0;
            NowPlaying.Proxy.user =
                    "" + readConfig("proxyUser", "" + NowPlayingDefaults.Proxy.user);
            NowPlaying.Proxy.password =
                    "" + readConfig("proxyPassword", "" + NowPlayingDefaults.Proxy.password);
        }

    } catch (err) {
        debugException(err, "function configureEventHandler");
    }
}

/* Called on configure event
 */
function configureEventHandler() {
    try {
        with (configureDialog.tabWidget.children()[0]) {
            // General
            tab_General.checkBox_UseNowPlaying.setChecked(NowPlaying.UseNowPlaying);

            // Login
            tab_Login.lineEdit_Pseudo.setText(NowPlaying.UserName);
            tab_Login.lineEdit_Password.setText(NowPlaying.UserPassword);

            // Advanced
            tab_Advanced.lineEdit_RemoteAppBase.setText(NowPlaying.RemoteAppBase);
            tab_Advanced.lineEdit_RemoteAppBasePort.setText(NowPlaying.RemoteAppBasePort);
            tab_Advanced.checkBox_ShowDebug.setChecked(NowPlaying.ShowDebug);
            tab_Advanced.checkBox_EnableBetaFeatures.setChecked(NowPlaying.EnableBetaFeatures);

            // Proxy
            tab_Proxy.checkBox_ProxyEnabled.setChecked(NowPlaying.Proxy.enabled);
            tab_Proxy.lineEdit_ProxyHost.setText(NowPlaying.Proxy.host);
            tab_Proxy.spinBox_ProxyPort.setValue(NowPlaying.Proxy.port);
            tab_Proxy.lineEdit_ProxyUser.setText(NowPlaying.Proxy.user);
            tab_Proxy.lineEdit_ProxyPassword.setText(NowPlaying.Proxy.password);
        }

        configureDialog.show();
    } catch (err) {
        debugException(err, "function configureEventHandler");
    }
}

/* Called when configure dialog is accepted
 */
function saveConfiguration() {
    try {
        with (configureDialog.tabWidget.children()[0]) {
            Amarok.Script.writeConfig("useNowPlaying",
                    tab_General.checkBox_UseNowPlaying.checked + "");

            Amarok.Script.writeConfig("userName",
                    tab_Login.lineEdit_Pseudo.text + "");
            if (tab_Login.lineEdit_Password.modified) {
                var userPassword = tab_Login.lineEdit_Password.text;
                Amarok.Script.writeConfig("userPassword",
                        tab_Login.lineEdit_Password.text + "");
            }

            Amarok.Script.writeConfig("remoteAppBase",
                    tab_Advanced.lineEdit_RemoteAppBase.text + "");
            Amarok.Script.writeConfig("remoteAppBasePort",
                    tab_Advanced.lineEdit_RemoteAppBasePort.text + "");
            Amarok.Script.writeConfig("showDebug",
                    tab_Advanced.checkBox_ShowDebug.checked + "");
            Amarok.Script.writeConfig("enableBetaFeatures",
                    tab_Advanced.checkBox_EnableBetaFeatures.checked + "");

            Amarok.Script.writeConfig("proxyEnabled",
                    tab_Proxy.checkBox_ProxyEnabled.checked + "");
            Amarok.Script.writeConfig("proxyHost",
                    tab_Proxy.lineEdit_ProxyHost.text + "");
            Amarok.Script.writeConfig("proxyPort",
                    tab_Proxy.spinBox_ProxyPort.value + "");
            Amarok.Script.writeConfig("proxyUser",
                    tab_Proxy.lineEdit_ProxyUser.text + "");
            Amarok.Script.writeConfig("proxyPassword",
                    tab_Proxy.lineEdit_ProxyPassword.text + "");
        }

        readConfig();
        initDebug();
        initBeta();
        // sendData({param: "test"});
    } catch (err) {
        debugException(err, "function saveConfiguration");
    }
}

/* Fill the proxy config tab with data from http_proxy env variable
 */
function proxyGuessFromEnvEvent() {
    try {
        var env = QProcess.systemEnvironment();
        var l = env.length;
        var url = "";
        for (var i = 0; i < l; ++i) {
            if (matches = env[i].match(/^http_proxy\s?=\s?(.+)/i)) {
                url = matches[1];
            }
        }
        if (url != "") {
            qUrl = new QUrl(url);
            with (configureDialog.tabWidget.children()[0]) {
                tab_Proxy.checkBox_ProxyEnabled.setChecked(true);
                tab_Proxy.lineEdit_ProxyHost.setText(qUrl.host());
                tab_Proxy.spinBox_ProxyPort.setValue(qUrl.port());
                tab_Proxy.lineEdit_ProxyUser.setText(qUrl.userName());
                tab_Proxy.lineEdit_ProxyPassword.setText(qUrl.password());
            }
        }

    } catch (err) {
        debugException(err, "function proxyGuessFromEnvEvent");
    }
}

function configDiagRestoreDefaults() {
    try {
        configureDialog.tabWidget.children()[0].tab_Advanced.lineEdit_RemoteAppBase.setText(NowPlayingDefaults.RemoteAppBase);
    } catch (err) {
        debugException(err, "function configDiagRestoreDefaults");
    }
}

/* Called on track event (play/pause/stop)
 */
function trackEventHandler() {
    try {
        if (NowPlaying.UseNowPlaying) {
            // Make an id for this request (workaround)
            var eventId;
            try {
                eventId = "pred" + Amarok.Engine.engineState() + Amarok.Engine.currentTrack().title + Amarok.Engine.currentTrack().artist + Amarok.Engine.currentTrack().album;
            }
            catch (e) {
                eventId = "pred" + Amarok.Engine.engineState();
            }

            if (eventId == lastProcessedEventId) {
                return;
            }
            lastProcessedEventId = eventId;

            var postData = {};
            var state = Amarok.Engine.engineState(); // 0: playing, 1: pause, 2: stop
            switch (state) {
                case 0:
                    // Add track informations
                    postData = fetchTrackData();
                    postData.action = (previousStatus == 1 && (previousSong == postData.file_name)) ? "resume" : "play";
                    previousStatus = 0;
                    previousSong = postData.file_name
                    break;
                case 1:
                    postData.action = "pause";
                    postData.current_song_id = currentSongDataFromServer.user_track;
                    previousStatus = 1;
                    break;
                case 2:
                    postData.action = "stop";
                    postData.current_song_id = currentSongDataFromServer.user_track;
                    currentSongDataFromServer = {};
                    previousStatus = 2;
                    break;

            }

            if (Amarok.Script.readConfig("cookie", "") != "") {
                cookieHeader = Amarok.Script.readConfig("cookie", "") + "";
                sendData(postData, cookieHeader);
            }
            else {
                authenticateToPredatum();
            }
        }
    } catch (err) {
        debugException(err, "function trackEventHandler");
    }
}

/* Refresh preview of the special post
 */
function commentPostRefreshPreview() {
    try {
        // TODO
    } catch (err) {
        debugException(err, "function commentPostRefreshPreview");
    }
}

/* Shows message as Amarok.Alert()
 */
function showMessage(message, icon, format) {
    try {
        if (icon == "" || icon == undefined) {
            icon = "Information";
        }
        var diag = new QMessageBox(QMessageBox[icon], "PredatumNP - Amarok", message);
        if (format) {
            diag.textFormat = Qt[format];
        }
        diag.setParent(this);
        diag.show();
    } catch (err) {
        debugException(err, "function showMessage");
    }
}

/* Debug function which works with exceptions.
 */
function debugException(e, context) {
    var data = "NowPlaying - Error:\n\nMessage: " + e + "\n" + "Context: " + context + "\n\n" +
            "An exception was found. You should upgrade your script, or, " +
            "if you have the latest version, submit a bug report. Thanks!";
    for (var i in e) {
        data += i + ": " + e[i] + "\n";
    }
    Amarok.alert(data);
}

/* Debug function
 */
function debugMessage(message, type) {
    if (NowPlaying.ShowDebug) {
        debug_text_box.append(
                "\n\n-----------------------------------------------------------\n" +
                type + " debug:" + "\n" + message
                );
    }
}

/* Debug function
 */
function debugObject(object, type) {
    if (NowPlaying.ShowDebug) {
        var data = "Object of type: " + typeof (object) + "\n";
        for (var i in object) {
            data += i + ": " + object[i] + "\n";
        }
        debugMessage(data, type);
    }
}

function initDebug() {
    try {
        if (NowPlaying.ShowDebug) {
            if (debug_text_box === 0) {
                debug_text_box = new QTextEdit();
                debug_text_box.setWindowTitle("NowPlaying debug");
                debug_text_box.readOnly = true;
                debug_text_box.setPlainText("NowPlaying debug");
                debug_text_box.resize(500, 400);
                debug_text_box.show();
            }
            else
                debug_text_box.show();
        }
        else if (debug_text_box !== 0) {
            debug_text_box.hide();
        }
    } catch (err) {
        debugException(err, "function initDebug");
    }
}

function initBeta() {
    try {
        if (NowPlaying.EnableBetaFeatures) {

        }
    } catch (err) {
        debugException(err, "function initBeta");
    }
}

/* Utilities
 */
QByteArray.prototype.toString = function () {
    ts = new QTextStream(this, QIODevice.ReadOnly);
    return ts.readAll();
};

function clone(o) {
    var newObj = (o instanceof Array) ? [] : {};
    for (i in o) {
        newObj[i] = o[i];
    }
    return newObj;
}
;

function isEmpty(o) {
    for (var i in o)
        if (o.hasOwnProperty(i))
            return false;

    return true;
}
/* Main:
 * load i18n
 * load UI files
 * signal-slots connections
 */

try {

// Puts configuration in the NowPlaying object.
    var NowPlaying = clone(NowPlayingDefaults);
    readConfig();

// FIXME Load i18n
// var translator = new QTranslator();
// translator.load("NowPlayingTranslations", "/translations");
// QMainApplication.installTranslator(&translator);
    function qsTr(p) {
        return String(p)
    }

// Load UI files
    var UIloader = new QUiLoader(this);
    var uiFile = new QFile(Amarok.Info.scriptPath() + "/Configure.ui");
    uiFile.open(QIODevice.ReadOnly);
    var configureDialog = UIloader.load(uiFile, this);
    uiFile.close();

    configureDialog.accepted.connect(saveConfiguration);
    configureDialog.tabWidget.children()[0].tab_Advanced.pushButton_RestoreDefaults.clicked.connect(
            configDiagRestoreDefaults);
// example: configureDialog.tabWidget.children()[0].tab_Login.label_Pseudo
    configureDialog.tabWidget.children()[0].tab_Login.label_NoticeLogin.setText(
            configureDialog.tabWidget.children()[0].tab_Login.label_NoticeLogin.text.replace(
            "%1", NowPlaying.RemoteAppBase + "/"));
    configureDialog.tabWidget.children()[0].tab_Proxy.pushButton_ProxyGuess.clicked.connect(
            proxyGuessFromEnvEvent);


    uiFile = new QFile(Amarok.Info.scriptPath() + "/CommentPost.ui");
    uiFile.open(QIODevice.ReadOnly);
    var commentPostDialog = UIloader.load(uiFile, this);
    uiFile.close();

// commentPostDialog.rateThisAlbum.textEdited.connect(commentPostRefreshPreview);
// commentPostDialog.reviewThisAlbum.textChanged.connect(commentPostRefreshPreview);
    commentPostDialog.accepted.connect(processCommentPost);


    initBeta();

// Check new version each 10 minutes until done (see QHttp.prototype.nowPlayingProcessReply)
    var timer = new QTimer();
    timer.timeout.connect(checkUpdate);
    timer.singleShot = true;
    timer.start(1000 * 60 * 10); // 10 minutes

    Amarok.Window.addSettingsSeparator();
    Amarok.Window.addSettingsMenu("npConfigure", qsTr("PredatumNP - Configure"));
    Amarok.Window.SettingsMenu.npConfigure['triggered()'].connect(configureEventHandler);

    Amarok.Window.addToolsSeparator();
    Amarok.Window.addToolsMenu("npCommentPost", qsTr("PredatumNP - Rate this music"));
    Amarok.Window.ToolsMenu.npCommentPost['triggered()'].connect(commentPostEventHandler);

    var lastProcessedEventId;
    var eventDelay = new QTimer();
    eventDelay.singleShot = true;
    function delayTrackEventHandler() {
        eventDelay.start(2000);
    }
    eventDelay.timeout.connect(trackEventHandler);

    Amarok.Engine.trackPlayPause.connect(delayTrackEventHandler);
    Amarok.Engine.trackChanged.connect(delayTrackEventHandler);
    Amarok.Engine.trackFinished.connect(delayTrackEventHandler);

    var debug_text_box = 0;
    initDebug();

    debugObject(NowPlaying);
    debugObject(NowPlayingDefaults);

} catch (err) {
    debugException(err, "main");
}
