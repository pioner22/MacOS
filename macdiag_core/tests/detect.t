use strict;
use warnings;
use Test::More;
use FindBin;
use JSON::PP;
use lib "$FindBin::Bin/../lib";
use MacDiag::Detect;
use MacDiag::Registry;
{
 package Fake;
 sub new {bless {calls=>[]},shift}
 sub run {
  my ($s,$a)=@_;push @{$s->{calls}},[@$a];
  my %out=(
   '/usr/bin/uname -s'=>"Darwin\n",'/usr/bin/uname -m'=>"x86_64\n",'/usr/bin/uname -r'=>"20.6.0\n",
   '/usr/bin/sw_vers -productVersion'=>"11.7.10\n",'/usr/bin/sw_vers -buildVersion'=>"20G1427\n",
   '/usr/sbin/sysctl -n hw.model'=>"MacBookPro16,1\n",'/usr/sbin/sysctl -n hw.memsize'=>"17179869184\n",
   '/usr/sbin/sysctl -n machdep.cpu.vendor'=>"GenuineIntel\n",'/usr/sbin/sysctl -n machdep.cpu.brand_string'=>"Intel CPU\n",
   '/usr/sbin/sysctl -n sysctl.proc_translated'=>"0\n",'/usr/sbin/sysctl -n hw.optional.arm64'=>"0\n",'/usr/sbin/sysctl -n kern.safeboot'=>"0\n",
   '/bin/bash --version'=>"GNU bash, version 3.2.57(1)-release\n",'/bin/zsh --version'=>"zsh 5.8 (x86_64-apple-darwin20.0)\n",
   '/usr/bin/curl -q --version'=>"curl 7.64.1 (x86_64-apple-darwin)\nProtocols: http https ftp\n",
   '/sbin/route -n get -inet 127.0.0.1'=>"route to: 127.0.0.1\ninterface: lo0\nflags: <UP,HOST>\n",
   '/usr/sbin/scutil --dns'=>"DNS configuration\nresolver #1\n nameserver[0] : 192.0.2.1\n",
   '/bin/launchctl print system/com.apple.configd'=>"system/com.apple.configd = {\n pid = 123\n}\n");
  my $key=join ' ',@$a;
  my $text=$out{$key};$text='Usage: curl' if $a->[0] eq '/usr/bin/curl' && $a->[-1] eq '--help';
  return {state=>'EXECUTED',stdout=>$text||'',stderr=>'',exit_code=>defined($text)?0:1,signal=>0};
 }
}
my $reg=MacDiag::Registry->new("$FindBin::Bin/../registry/catalog.json");
my $fake=Fake->new;
my $d=MacDiag::Detect->new(runner=>$fake,registry=>$reg,bash_version=>'3.2.57(1)-release',code_revision=>'synthetic',
 path_exists=>sub {$_[0] =~ /(?:Finder\.app|AppleSetupDone)\z/},path_exec=>sub {$_[0] ne '/usr/bin/networkQuality'});
my $s=$d->collect;
is($s->{selection}{id},'big-sur-intel-bash32','synthetic Big Sur selected');
is($s->{facts}{ram_bytes},'17179869184','RAM fact measured');
is($s->{capabilities}{'curl.https_api'}{state},'VERIFIED','local curl options verified');
is($s->{capabilities}{'speed.apple'}{state},'MISSING','absent NQ explicit');
my $json=JSON::PP->new->encode($s);
unlike($json,qr/password|SerialNumber|IOPlatformUUID|SSH_CONNECTION/,'no sensitive inventory keys');
my @calls=map {join(' ',@$_)} @{$fake->{calls}};
ok(!grep(/https:\/\//,@calls),'collector makes no network requests');
ok(!grep(/python3|xcrun|softwareupdate|sudo|system_profiler/,@calls),'no install stubs or broad sensitive inventories');
my $s2=$d->collect;is($s->{profile_fingerprint},$s2->{profile_fingerprint},'stable fingerprint excludes timestamp');
$d->{code_revision}='different';isnt($d->collect->{profile_fingerprint},$s->{profile_fingerprint},'code revision invalidates fingerprint');
$d->{bash_version}='5.2.0';isnt($d->collect->{profile_fingerprint},$s2->{profile_fingerprint},'dispatcher revision invalidates fingerprint');
is($s->{device_reference}{candidates}[0]{hardware_test},'NOT_TESTED','synthetic observation does not certify hardware');
done_testing();
