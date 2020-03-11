#!/usr/bin/perl -w

use warnings;

# from https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames#Perl (but removed flooring since we need the offset in the tile)
use Math::Trig;
sub getTileNumber {
  my ($lat,$lon,$zoom) = @_;
  my $xtile = (($lon+180)/360 * 2**$zoom ) ;
  my $ytile = ( (1 - log(tan(deg2rad($lat)) + sec(deg2rad($lat)))/pi)/2 * 2**$zoom ) ;
  return ($xtile, $ytile);
}

sub round {
    $_[0] && int($_[0] + 0.5)
}
sub getTileFile {
    my ($base_url, $base_file, $lat, $lon) = @_;
    my $zoom = 16;
    my ($xtile_, $ytile_) = getTileNumber($lat, $lon, $zoom);
    my $xtile = int($xtile_);
    my $ytile = int($ytile_);
    #print "$xtile_, $ytile_\n";
    my $file = "$base_file-$ytile-$xtile.jpg";
    if (! -f $file) {
        my $url = "$base_url/$zoom/$ytile/$xtile";
        warn "getting $url\n";
        system 'wget', '-q', '-O', $file, $url;
    }
    $file, (map { round($_ * 256) } $xtile_ - $xtile, ($ytile_ - $ytile));
}

sub color2value {
    my ($r, $g, $b) = @_;
    my $marge = 12;
    if ($g < 0x51 - $marge) {
        # rouge
        $b < 0x20 && $r > 0x80 - $marge or warn sprintf("weird color %02x %02x %02x\n", $r, $g, $b);
        $g < 0x40 or warn sprintf("weird color %02x %02x %02x\n", $r, $g, $b);

        (41 + (80 - 41) * (0xff - $r) / (0xff - 0x80))
    } elsif ($r > 0xff - $marge) {
        # orange
        (24 + (40 - 24) * (0xff - $g) / (0xff - 0x51));
    } elsif ($b < $marge) {
        16 + (24 - 16) * ($r - 0x99) / (0xff - 0x99);
    } else {
        8 + (15 - 8) * (0xaa - $b) / (0xaa - 0x15);
    }
}

sub color2value_pm25 {
    my ($r, $g, $b) = @_;
    my $marge = 12;
    if ($g < 0x51 - $marge) {
        # rouge
        $b < 0x20 && $r > 0x80 - $marge or warn sprintf("weird color %02x %02x %02x\n", $r, $g, $b);
        $g < 0x40 or warn sprintf("weird color %02x %02x %02x\n", $r, $g, $b);

        (26 + (50 - 26) * (0xff - $r) / (0xff - 0x80))
    } elsif ($r > 0xff - $marge) {
        # orange
        (15 + (25 - 15) * (0xff - $g) / (0xff - 0x51));
    } elsif ($b < $marge) {
        10 + (15 - 10) * ($r - 0x99) / (0xff - 0x99);
    } else {
        1 + (9 - 1) * (0xaa - $b) / (0xaa - 0x2a);
    }
}

use JSON;

my $no2_2018_layer_name = 'mod_idf_no2_2018_moyenne_annuelle';
my $no2_2017_layer_name = 'mod_idf_no2_2017_2';

my $pm10_2018_layer_name = 'mod_idf_pm10_2018_moyenne_annuelle';
my $pm25_2018_layer_name = 'mod_idf_pm25_2018_moyenne_annuelle';

sub to_base_url_and_file {
    my ($layer_name) = @_;
    ("https://tiles.arcgis.com/tiles/gtmasQsdfwbDAQSQ/arcgis/rest/services/$layer_name/MapServer/tile", $layer_name);
}

sub get_value {
    my ($layer_name, @coords) = @_;
    my ($tile_file, $delta_x, $delta_y) = getTileFile(to_base_url_and_file($layer_name), @coords);
    #print join(' ', $tile_file, $delta_x, $delta_y), "\n";

    if (-z $tile_file) {
        return undef;
    }
    use Image::Magick;
    my $image = Image::Magick->new;
    $image->Read($tile_file);
    my @rgb = map { $_ * 255 } $image->GetPixel(x => $delta_x, y => $delta_y);
    my $rgb = join(' ', map { sprintf "%02X", $_ } @rgb);
    my $value = $layer_name =~ /pm25/ ? color2value_pm25(@rgb) : color2value(@rgb);
    #print "$layer_name: $rgb : $value\n";
    $value;
}

sub update_data {
    my ($all_data) = JSON::decode_json(`cat data.json`);
    my $i = 0;
    foreach my $e (@$all_data) {

	if (1) {
        $e->{d}{2018} = {
            no2 => round(get_value($no2_2018_layer_name, $e->{x}, $e->{y})),
            pm10 => round(get_value($pm10_2018_layer_name, $e->{x}, $e->{y})),
            pm25 => round(get_value($pm25_2018_layer_name, $e->{x}, $e->{y})),
        };

        } else {
            my $no2_2017 = get_value($no2_2017_layer_name, $e->{x}, $e->{y});
            my $expected_no_2017 = $e->{d}{2017}{no2};
            if (abs($no2_2017 - $expected_no_2017) > 4) {
                print "expected: $expected_no_2017 computed: $no2_2017 ($e->{label})\n";
            }
        }
        #last if $i++ > 1000;
    }
    print JSON::encode_json($all_data);
}



sub test_colors {
    my $colors = <<'EOS';
 8 = # 00 cc aa
 9 = # 13 cf 94
15 = # 85 e2 15

jaunes :
16 = # 99 e6 00
23 = # f2 fb 00

oranges :
24 = # ff ff 00
25 = # ff f4 00
39 = # ff 5d 00
40 = # ff 51 00

rouges :
41 = # ff 00 00
79 = # 83 00 00
80 = # 80 00 00
EOS

    my $colors_pm25 = <<'EOS';

 1 = # 00 cc aa
 9 = # 72 df 2a

10 = # 99 e6 00
14 = # e5 f8 00

oranges :
15 = # ff ff 00
16 = # ff e9 00
24 = # ff 5d 00
25 = # ff 51 00

rouges :
26 = # ff 00 00
49 = # 85 00 00
50 = # 80 00 00
EOS

    foreach (split "\n", $colors) {
        my ($value, @rgb) = /(\d+) = # (\w+) (\w+) (\w+)/ or next;
        my $computed_value = color2value(map { hex($_) } @rgb);
        print "@rgb : wanted:$value computed:$computed_value\n" if abs($computed_value - $value) > .3;
    }


    foreach (split "\n", $colors_pm25) {
        my ($value, @rgb) = /(\d+) = # (\w+) (\w+) (\w+)/ or next;
        my $computed_value = color2value_pm25(map { hex($_) } @rgb);
        print "pm25: @rgb : wanted:$value computed:$computed_value\n" if abs($computed_value - $value) > .4;
    }
}

update_data();


use Data::Dumper;

my @coords_pollue = (48.85925, 2.35262);
my @coords_moins_pollue = (48.85994, 2.35100);
my @girard = (48.88635,2.36109);
