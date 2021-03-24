#!/usr/bin/perl -w

use warnings;

use JSON;

sub round {
    $_[0] && int($_[0] + 0.5)
}

sub layer_name {
    my ($annee, $polluant) = @_;
    # downloaded from https://www.atmo-auvergnerhonealpes.fr/cartotheque
    "aura/moyan_${polluant}_${annee}_aura.tif"
}

sub output_file {
    my ($filename, @lines) = @_;
    open(my $F, '>', $filename);
    print $F $_ foreach @lines;
    close($F);
}

sub get_values_ {
    my ($geotiff_file, @l) = @_;
    my $coords_file = '/tmp/coords';
    output_file($coords_file, map { "$_->{y} $_->{x}\n" } @l);
    map { chomp; $_ } `gdallocationinfo -valonly -wgs84 $geotiff_file < $coords_file`;
}

sub get_values {
    my ($annee, @l) = @_;

    foreach my $polluant ('no2', 'pm10', 'pm25') {
        my @values = get_values_(layer_name($annee, $polluant), @l);
        my $i = 0;
        foreach my $e (@l) {
            $e->{d}{$annee}{$polluant} = round($values[$i++]);
        }
    }
}

sub update_data {
    my ($input_data_file) = @_;
    my ($all_data) = JSON::decode_json(join('', `cat $input_data_file`));
    my $i = 0;
    foreach my $annee ('2015', '2016', '2017', '2018', '2019') {
        my @todo;
        foreach my $e (@$all_data) {
            $e->{d}{$annee} = {};
            push @todo, $e;
            if (@todo > 100) { 
                get_values($annee, @todo);
                @todo = ();
            }
        }
        @todo and get_values($annee, @todo)
        #last if $i++ > 1000;
    }
    #@$all_data = grep { $_->{d}{2019}{no2} } @$all_data;
    print JSON::encode_json($all_data);
}

update_data($ARGV[0]);

