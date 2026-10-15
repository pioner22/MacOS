#!/usr/bin/perl
# SPDX-License-Identifier: GPL-3.0-or-later
# Read-only logical-range scan. No write handles, raw contents, hashes or repair.
use strict;
use warnings;
use Fcntl qw(O_RDONLY O_NOFOLLOW SEEK_SET S_ISREG S_ISCHR);
use Config;
use Errno qw(EINTR EIO);
our $cancel=0;
my $hires=eval {require Time::HiRes;Time::HiRes::clock_gettime(Time::HiRes::CLOCK_MONOTONIC());1};
sub ro_clock {return $hires?Time::HiRes::clock_gettime(Time::HiRes::CLOCK_MONOTONIC()):time;}
sub ro_read {return sysread($_[0],$_[1],$_[2]);}
sub ro_seek {return sysseek($_[0],$_[1],SEEK_SET);}
sub ro_num {return defined($_[0]) && $_[0]=~/\A(?:0|[1-9][0-9]{0,15})\z/;}
sub ro_error_code {my $e=shift;return 2 if $e==EIO;my $dev=eval {Errno::EDEVERR()};return defined($dev)&&$e==$dev?2:3;}
sub ro_meta {
 my ($disk,$xml)=@_;
 return 3 unless $disk=~/\Adisk(?:0|[1-9][0-9]{0,3})\z/ && length($xml)<=1048576;
 # Parse only the scalar keys used in the contract. Unknown/duplicate fields
 # fail closed. This is NOT a general-purpose XML parser; nothing is evaluated.
 return 3 unless $xml=~/<plist\b/ && $xml=~m{</plist>\s*\z};
 my %v;
 for my $key(qw(DeviceIdentifier DeviceNode Whole VirtualOrPhysical TotalSize DeviceBlockSize)){
   my @keys=($xml=~m{<key>\Q$key\E</key>}g);return 3 unless @keys==1;
   my ($value)=$xml=~m{<key>\Q$key\E</key>\s*(<(?:string|integer)>[^<]*</(?:string|integer)>|<(?:true|false)\s*/>)};
   return 3 unless defined $value;
   $v{$key}=$value;
 }
 return 3 unless $v{DeviceIdentifier} eq "<string>$disk</string>" && $v{DeviceNode} eq "<string>/dev/$disk</string>";
 return 3 unless $v{Whole}=~/\A<true\s*\/>\z/ && $v{VirtualOrPhysical} eq '<string>Physical</string>';
 my ($size)=$v{TotalSize}=~m{\A<integer>([0-9]+)</integer>\z};
 my ($block)=$v{DeviceBlockSize}=~m{\A<integer>([0-9]+)</integer>\z};
 return 3 unless ro_num($size)&&ro_num($block)&&$size>0&&$size<=1125899906842624;
 return 3 unless $block>=512&&$block<=65536&&($block & ($block-1))==0&&$size%$block==0;
 print "$disk\t$size\t$block\n" or return 3;return 0;
}
sub ro_scan {
 my ($kind,$path,$size,$sector,$mode,$seconds)=@_;
 return 3 unless $Config{ivsize}>=8 && ro_num($size)&&$size>0&&$size<=1125899906842624;
 return 3 unless ro_num($sector)&&$sector>=1&&$sector<=65536&&($sector & ($sector-1))==0 && $size%$sector==0;
 return 3 unless $mode eq 'full'||$mode eq 'quick';
 return 3 unless ro_num($seconds)&&$seconds>=1&&$seconds<=86400;
 if($kind eq 'device') {return 3 unless $^O eq 'darwin' && $path=~/\A\/dev\/rdisk(?:0|[1-9][0-9]{0,3})\z/ && $sector>=512;}
 elsif($kind ne 'image'){return 3;}
 return 3 if -l $path;
 sysopen(my $fh,$path,O_RDONLY|O_NOFOLLOW) or do {print "READ_OPEN_ERROR errno=".(0+$!)."\n";return 3;};
 binmode $fh;my @st=stat($fh);
 unless(@st && ($kind eq 'device'?S_ISCHR($st[2]):S_ISREG($st[2]))){close $fh;return 3;}
 if($kind eq 'image' && $st[7]!=$size){close $fh;return 3;}
 $|=1;$cancel=0;
 local $SIG{INT}=sub{$cancel=130};local $SIG{TERM}=sub{$cancel=143};local $SIG{HUP}=sub{$cancel=129};
 local $SIG{ALRM}=sub{$cancel=124};alarm($seconds);
 my ($readbytes,$calls,$slow,$errors,$rc)=(0,0,0,0,0);
 my $chunk=1048576;my $start=ro_clock();my $next=$start+5;
 my @windows;
 if($mode eq 'quick'){
   if($size<=32*$chunk){@windows=([0,$size]);}
   else {for my $i(0..31){my $off;{use integer;$off=(($size-$chunk)*$i/31/$sector)*$sector;}push @windows,[$off,$chunk];}}
 }else{@windows=([0,$size]);}
 my $planned=0;$planned+=$_->[1] for @windows;
 print "READONLY_BEGIN kind=$kind mode=$mode total_bytes=$size planned_bytes=$planned block_bytes=$sector access=O_RDONLY\n";
 print "READONLY_SCOPE=READABILITY_ONLY write_test=NOT_PERFORMED content_correctness=UNKNOWN physical_sector_mapping=UNKNOWN\n";
 print 'READONLY_CLOCK='.($hires?'MONOTONIC':'WALL_SECONDS')."\n";
 WINDOW:for my $win(@windows){
  my ($offset,$length)=@$win;my $end=$offset+$length;
  while($offset<$end){
   if($cancel){$rc=$cancel;last WINDOW;}
   my $requested=($end-$offset)<$chunk?$end-$offset:$chunk;
   my $seek=ro_seek($fh,$offset);
   if(!defined $seek){my $err=0+$!;$errors++;$rc=ro_error_code($err);print "READ_SEEK_ERROR offset=$offset errno=$err\n";last WINDOW;}
   my $done=0;my $t=ro_clock();
   while($done<$requested){
    if($cancel){$rc=$cancel;last WINDOW;}
    my $buf='';my $n=ro_read($fh,$buf,$requested-$done);$calls++;
    if(!defined $n){
     my $err=0+$!;next if $err==EINTR;
     $errors++;$rc=ro_error_code($err);
     print 'READ_IO_ERROR offset='.($offset+$done).' lba='.int(($offset+$done)/$sector)." request_bytes=".($requested-$done)." errno=$err component=UNCONFIRMED\n";last WINDOW;
    }
    if($n==0){$errors++;$rc=2;print 'READ_UNEXPECTED_EOF offset='.($offset+$done)."\n";last WINDOW;}
    $readbytes+=$n;$done+=$n;
   }
   my $duration=ro_clock()-$t;
   if($duration>=1){$slow++;printf "READ_SLOW_OBSERVATION offset=%s seconds=%.3f not_a_bad_sector_diagnosis=1\n",$offset,$duration if $slow<=20;}
   $offset+=$requested;
   if(ro_clock()>=$next || $readbytes==$planned){
    printf "READ_PROGRESS tested_bytes=%s planned_bytes=%s percent=%.2f elapsed_seconds=%.1f\n",$readbytes,$planned,100*$readbytes/$planned,ro_clock()-$start;$next=ro_clock()+5;
   }
  }
 }
 alarm(0);
 if(!close($fh)&&!$rc){$rc=3;print 'READ_CLOSE_ERROR errno='.(0+$!)."\n";}
 $rc=$cancel if !$rc&&$cancel;
 $rc=3 if !$rc&&$readbytes!=$planned;
 printf "READONLY_SUMMARY mode=%s total_bytes=%s planned_bytes=%s tested_bytes=%s read_calls=%s errors=%s slow_observations=%s elapsed_seconds=%.3f exit_code=%s\n",$mode,$size,$planned,$readbytes,$calls,$errors,$slow,ro_clock()-$start,$rc;
 if(!$rc){print 'ENGINE_COMPLETE='.($mode eq 'full'?'READONLY_FULL_READ':'READONLY_SAMPLE_READ')."\n";}
 return $rc;
}
sub ro_main {
 if(@ARGV==2 && $ARGV[0] eq '--metadata'){
  my $xml='';while(length($xml)<=1048576){my $n=sysread(STDIN,my $b,65536);return 3 if !defined $n;last if !$n;$xml.=$b;}
  my $rc=ro_meta($ARGV[1],$xml);print STDERR "READ_METADATA_INVALID\n" if $rc;return $rc;
 }
 if(@ARGV==3 && $ARGV[0] eq '--image'){
  my @s=lstat($ARGV[1]);return 3 unless @s&&S_ISREG($s[2])&&$s[7]>0;
  return ro_scan('image',$ARGV[1],$s[7],1,$ARGV[2],60);
 }
 if(@ARGV==6 && $ARGV[0] eq '--device'){shift @ARGV;return ro_scan('device',@ARGV);}
 print STDERR "READONLY_USAGE: --device /dev/rdiskN bytes sector quick|full timeout | --image file quick|full | --metadata diskN\n";
 return 3;
}
unless(caller){exit ro_main();}
1;
