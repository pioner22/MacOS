use strict;
use warnings;
use utf8;
use Test::More;
use JSON::PP;
use File::Temp qw(tempdir);
use FindBin;
use lib "$FindBin::Bin/../lib";
use MacDiag::Registry;
use MacDiag::Detect;
use MacDiag::Adapters;
use MacDiag::Runner;

my $root="$FindBin::Bin/..";
my $reg=MacDiag::Registry->new("$root/registry/catalog.json");
sub result { my ($out,$err,$rc,$state)=@_; return {state=>$state||'EXECUTED',stdout=>$out||'',stderr=>$err||'',exit_code=>defined($rc)?$rc:0,signal=>0} }
sub die_like { my ($fn,$re,$name)=@_; my $yes=eval {$fn->();1}; ok(!$yes && $@ =~ $re,$name) }
my $facts=MacDiag::Detect::derive({kernel=>'Darwin',process_arch=>'x86_64',cpu_vendor=>'GenuineIntel',os_version=>'11.7.10',os_build=>'20G1427',system_bash=>'3.2.57',finder=>1,setup_done=>1,model_identifier=>'MacBookPro16,1'});
is($facts->{environment},'full','full system is heuristic, not root UID');
is($facts->{environment_confidence},'HEURISTIC','confidence is explicit');
is($facts->{hardware_family},'intel','vendor + process support Intel');
is($facts->{os_family},'big_sur','OS family from running version');
is($facts->{bash_family},'bash32','Bash family measured');
is($reg->resolve($facts)->{id},'big-sur-intel-bash32','composable exact profile');
is(MacDiag::Detect::derive({kernel=>'Darwin',process_arch=>'x86_64',translated=>1})->{hardware_family},'apple_silicon','Rosetta is not Intel');
is(MacDiag::Detect::derive({kernel=>'Darwin',process_arch=>'arm64'})->{hardware_family},'apple_silicon','arm64 process');
is(MacDiag::Detect::derive({kernel=>'Darwin',process_arch=>'x86_64'})->{hardware_family},'unknown','x86 alone insufficient');
is(MacDiag::Detect::derive({kernel=>'Darwin',cdis=>1,base_system=>1})->{environment},'recovery_like','Recovery indicators');
is(MacDiag::Detect::derive({kernel=>'Darwin',cdis=>1})->{environment},'installer_or_recovery','CDIS alone ambiguous');
is(MacDiag::Detect::derive({kernel=>'Darwin',safe_boot=>1,finder=>1,setup_done=>1})->{environment},'safe','safe mode wins');
is(MacDiag::Detect::derive({kernel=>'Darwin'})->{environment},'unknown','no facts remains unknown');
is(MacDiag::Detect::derive({kernel=>'Darwin',cdis=>1,base_system=>1})->{recovery_origin},'unknown','internet vs local Recovery not invented');
for my $v ('99.1','garbage','10',undef) {is(MacDiag::Detect::family($v),'unknown','unknown OS version')}
is($reg->device('MacBookPro11,2')->{state},'AMBIGUOUS','reused model ID preserves multiple years');
is(scalar @{$reg->device('MacBookPro11,2')->{candidates}},2,'two documented candidate years');
is($reg->device('NotAMac1,1')->{state},'UNKNOWN','unknown model has no invented year');
is($reg->device('MacBookPro16,4')->{candidates}[0]{year_introduced},2019,'source-backed seed');
my $data=JSON::PP->new->decode(JSON::PP->new->encode($reg->data));
push @{$data->{rules}}, {id=>'conflict',priority=>300,match=>{kernel=>'Darwin',os_family=>'big_sur',environment=>'full',hardware_family=>'intel',bash_family=>'bash32'}};
my $d=tempdir(CLEANUP=>1);open my $f,'>',"$d/r.json" or die;print $f JSON::PP->new->encode($data);close $f;
my $conflict=MacDiag::Registry->new("$d/r.json");
is($conflict->resolve($facts)->{state},'AMBIGUOUS','equal priority conflict blocks instead of first row wins');
my %caps=map {$_=>{state=>'VERIFIED'}} qw(metadata.collect kernel.darwin curl.https_api route.query dns.query service.query);
my $snap={schema=>'macdiag.profile.v1',facts=>$facts,capabilities=>\%caps};
sub item {my ($plan,$id)=@_;(grep {$_->{id} eq $id} @{$plan->{items}})[0]}
my $plan=$reg->plan($snap);
is(item($plan,'network.ip')->{state},'BLOCKED','network blocked by default');
is(item($plan,'network.routes')->{state},'AVAILABLE','route read is allowed');
is(item($plan,'vpn.install')->{reason},'NOT_IMPLEMENTED','no accidental legacy VPN handoff');
is(item($plan,'memory.stress')->{state},'BLOCKED','stress not executable');
$plan=$reg->plan($snap,policy=>'diagnostic');
is(item($plan,'network.ip')->{reason},'NETWORK_CONSENT_REQUIRED','consent independent of policy');
$plan=$reg->plan($snap,policy=>'diagnostic',allow_network=>1);
is(item($plan,'network.ip')->{state},'AVAILABLE','explicit policy + consent');
my $old=$caps{'curl.https_api'}{state};$caps{'curl.https_api'}{state}='PRESENT_UNPROBED';
is(item($reg->plan($snap,policy=>'diagnostic',allow_network=>1),'network.ip')->{state},'SKIP','present not verified');
$caps{'curl.https_api'}{state}=$old;
is(item($conflict->plan($snap),'network.routes')->{state},'BLOCKED','ambiguity blocks operations');
is($reg->plan($snap,offline=>1)->{source},'SAVED_SNAPSHOT_UNTRUSTED','saved snapshot evidence untrusted');
my $unknown={%$snap,facts=>{%$facts,environment=>'unknown'}};
is(item($reg->plan($unknown,policy=>'diagnostic',allow_network=>1),'network.ip')->{reason},'ENVIRONMENT_UNKNOWN','unknown environment restricted');
die_like(sub {MacDiag::Registry::read_json('/dev/null')},qr/JSON_NOT_REGULAR/,'no device JSON input');
open $f,'>',"$d/bad.json";print $f '{"schema":';close $f;
die_like(sub {MacDiag::Registry::read_json("$d/bad.json")},qr/JSON_INVALID/,'invalid JSON rejected');
symlink "$d/r.json","$d/link";
die_like(sub {MacDiag::Registry::read_json("$d/link")},qr/JSON_OPEN/,'symlink JSON rejected');

my $good="   route to: 1.1.1.1\n  interface: utun98\n      flags: <UP,GATEWAY,STATIC>\n";
is(MacDiag::Adapters::route_result(result($good))->{state},'FOUND','route found');
is(MacDiag::Adapters::route_result(result($good))->{interface},'utun98','exact interface');
for my $rc (0,1) {
 is(MacDiag::Adapters::route_result(result(" route to: 2606:4700:4700::1111\n","route: message indicates error 3: No such process\n",$rc))->{state},'ABSENT',"Apple rc=$rc no route");
}
for my $r (result('','',124,'TIMEOUT'),result('',"route: permission denied\n",1),result(''),result($good,"unknown warning\n"),result($good.$good),result("interface: utun98\n")) {
 is(MacDiag::Adapters::route_result($r)->{state},'ERROR','unknown/timeout/malformed is not ABSENT');
}
for my $flag ('REJECT','BLACKHOLE') {is(MacDiag::Adapters::route_result(result("interface: utun98\nflags: <UP,$flag>\n"))->{state},'UNUSABLE',"$flag not usable")}
is(MacDiag::Adapters::route_result(result($good,"route: message indicates error 3: No such process\n"))->{state},'ERROR','contradictory route');
is(MacDiag::Adapters::route_result(result("route to: ::1\n","route: message indicates error 3: No such process\npermission denied\n"))->{state},'ERROR','no-route does not hide another error');
is(MacDiag::Adapters::service_result(result('',"Could not find service \"test.label\" in domain for system\n",113),'test.label')->{state},'ABSENT','service known absent');
is(MacDiag::Adapters::service_result(result('','',124,'TIMEOUT'),'test.label')->{state},'ERROR','service timeout != off');
is(MacDiag::Adapters::service_result(result("system/test.label = {\n pid = 123\n}\n"),'test.label')->{process_state},'RUNNING','service pid observation');
is(MacDiag::Adapters::service_result(result('',"Could not find service \"other\"\n",113),'test.label')->{state},'ERROR','wrong service not accepted');
is(MacDiag::Adapters::dns_result(result("no DNS configuration available\n"))->{state},'ABSENT','explicit absent DNS');
is(MacDiag::Adapters::dns_result(result("DNS configuration\nresolver #1\n  nameserver[0] : 1.1.1.1\n"))->{resolver_count},1,'DNS inventory not leak proof');
is(MacDiag::Adapters::dns_result(result(''))->{state},'ERROR','empty DNS unknown');
for my $value ('999.1.1.1','01.2.3.4','::1','1.2.3','1.2.3.4\n') {ok(!defined(MacDiag::Adapters::ipv4($value)),'invalid IPv4')}
is(MacDiag::Adapters::ipv4('198.51.100.2'),'198.51.100.2','valid IPv4');
my $http="198.51.100.2\n\n__MACDIAG_HTTP__200\t192.0.2.1\n";
is(MacDiag::Adapters::curl_result(result($http),1)->{external_ipv4},'198.51.100.2','ifconfig.me parsed');
is(MacDiag::Adapters::curl_result(result($http),1)->{vpn_proof},'NOT_PROVEN_BY_IP_ALONE','IP is not VPN proof');
for my $r (result($http,'',60),result('html'),result("html\n__MACDIAG_HTTP__200\t192.0.2.1\n"),result("1.1.1.1\n__MACDIAG_HTTP__302\t192.0.2.1\n")) {
 isnt(MacDiag::Adapters::curl_result($r,1)->{state},'PASS','TLS/HTML/redirect errors do not pass');
}
done_testing();
