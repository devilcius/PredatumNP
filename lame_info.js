Importer.loadQtBinding( "qt.core" );

function getPreset() {

	var f = new QFile(Amarok.Engine.currentTrack().path);
	f.open(QIODevice.ReadOnly)
	var data = new QByteArray(f.read(32768));
	var ts = new QTextStream(data, QIODevice.ReadOnly);
	var str = ts.read(32768);	
	//embeded image?
	if(data.indexOf("image") > -1) {
		data = new QByteArray(f.read(f.size()));
		ts = new QTextStream(data, QIODevice.ReadOnly);
		str = ts.read(f.size);
	}
	var xing = 0;
	var is_cbr = false;
	var preset = null;
	
	if(data.indexOf("LAME") == -1) {
		return null;
	} 
	if(data.indexOf("Xing") > -1) {
		xing = data.indexOf("Xing");
	}
	else {
		xing = data.indexOf("Info");
		is_cbr = true;
	}
	var encoder = str.substring(xing + 120, xing + 128)
	var lame = xing + 120;	
	var vbr_method = data.at(lame + 9) & 0xF; 
	var lowpass = data.at(lame + 10) & 0xFF;
	var ath_type = data.at(lame + 19) & 0xF;
	if (is_cbr) {
		preset = Amarok.Engine.currentTrack().bitrate; 
	}
	else {
		preset = (data.at(lame+27) + data.at(lame+28)) & 0x1FF;
		var array_preset = [410, 420, 430, 440, 450, 460, 470, 480, 490, 500]
		if (array_preset.indexOf(preset) > -1) {
			preset = 'V' + ((500 - preset) / 10);
		}
		else {
			var presets = ['R3MIX', 'APS', 'APE', 'API', 'APFS', 'APFE','APM', 'APFM']
			preset = presets[preset - 1001]
			if(preset == undefined) {
				preset = ''; //at least the function won't return null
				var lame_version = encoder.substring(4,8);
				var major_version = lame_version.split('.')[0];
				var minor_version = lame_version.split('.')[1];
				var version = parseInt(major_version + minor_version);	
				if (version < 390 && version > 0) {
					if (vbr_method == 8 && (lowpass == 97 || lowpass == 98) && ath_type == 0)
						preset = 'R3MIX'
				}
				else if (version >= 390 && version < 397) {
					if (vbr_method == 3){
						if (lowpass == 195 || lowpass == 196) {
							if (ath_type == 2 || ath_type == 4) {
								preset = 'APE' 
							}
						}		
						else if (lowpass == 190 && ath_type == 4) {
							preset = 'APS'					
						}
						else if (lowpass == 180 && ath_type == 4) {
							preset = 'APM'
						}
					}
					else if (vbr_method == 4) {
						if (lowpass == 195 || lowpass == 196) {
							if (ath_type == 2 || ath_type == 4) {
								preset = 'APFE' 
							}
							else if (ath_type == 3) {
								preset = 'R3MIX' 
							}
						}
						else if (lowpass == 190 && ath_type == 4) {
							preset = 'APFS' 
						}
						else if (lowpass == 180 && ath_type == 4) {
							preset = 'APFM' 
						}
					}
					else if ((vbr_method == 1 || vbr_method == 2) && (lowpass == 205 || lowpass == 206) && (ath_type == 2 || ath_type == 4)) {
						preset = 'API'	
					}
				}	
				
			}
		}
	}
	return preset;
}
