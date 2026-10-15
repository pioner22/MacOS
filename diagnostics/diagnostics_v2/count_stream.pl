#!/usr/bin/perl
use strict;
use warnings;
# Count exactly the bytes delivered to the hash process, with a bounded buffer.
my ($limit, $report) = @ARGV;
die "invalid arguments\n" unless defined $report && $limit =~ /^\d+$/ && $limit > 0;
binmode STDIN; binmode STDOUT;
my ($total, $rc) = (0, 0);
while (1) {
    my $n = sysread(STDIN, my $buf, 65536);
    if (!defined $n) { next if $!{EINTR}; $rc = 3; last; }
    last if $n == 0;
    $total += $n;
    if ($total > $limit) { $rc = 4; last; }
    my $pos = 0;
    while ($pos < $n) {
        my $w = syswrite(STDOUT, $buf, $n - $pos, $pos);
        if (!defined $w) { next if $!{EINTR}; exit 3; }
        exit 3 if $w == 0;
        $pos += $w;
    }
}
open my $fh, '>', $report or die "count report: $!\n";
print $fh "$total\n" or die "count write: $!\n";
close $fh or die "count close: $!\n";
exit $rc;
