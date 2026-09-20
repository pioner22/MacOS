package MacDiag::Registry;
use strict;
use warnings;
use JSON::PP;
use Digest::SHA qw(sha256_hex);
use Fcntl qw(O_RDONLY O_NOFOLLOW);

sub read_json {
    my ($path) = @_;
    sysopen(my $fh, $path, O_RDONLY | O_NOFOLLOW) or die "JSON_OPEN_FAILED\n";
    my @s = stat($fh);
    die "JSON_NOT_REGULAR_OR_TOO_LARGE\n" unless -f $fh && $s[7] <= 2097152;
    binmode $fh;
    local $/; my $bytes = <$fh>; close $fh;
    die "JSON_TOO_LARGE\n" if length($bytes) > 2097152;
    my $value = eval { JSON::PP->new->utf8->max_depth(32)->decode($bytes) };
    die "JSON_INVALID\n" if $@ || ref($value) ne 'HASH';
    return $value;
}
sub new {
    my ($class, $path) = @_;
    my $data = read_json($path);
    die "REGISTRY_SCHEMA\n" unless ($data->{schema} || '') eq 'macdiag.registry.v1' && ref($data->{rules}) eq 'ARRAY' && ref($data->{devices}) eq 'ARRAY' && ref($data->{modules}) eq 'ARRAY';
    my %ids;
    for my $r (@{$data->{rules}}) {
        die "REGISTRY_RULE\n" unless ref($r) eq 'HASH' && ($r->{id}||'') =~ /\A[a-z0-9._-]+\z/ && !$ids{$r->{id}}++ && ref($r->{match}) eq 'HASH' && ($r->{priority}||'') =~ /\A\d+\z/;
        for my $key (keys %{$r->{match}}) {
            die "REGISTRY_MATCH_KEY\n" unless $key =~ /\A(?:kernel|os_family|hardware_family|environment|bash_family)\z/;
            die "REGISTRY_MATCH_VALUE\n" if ref($r->{match}{$key});
        }
    }
    %ids = ();
    for my $m (@{$data->{modules}}) {
        die "REGISTRY_MODULE\n" unless ref($m) eq 'HASH' && ($m->{id}||'') =~ /\A[a-z0-9._-]+\z/ && !$ids{$m->{id}}++ && ref($m->{requires}) eq 'ARRAY';
        die "REGISTRY_REQUIREMENT\n" if grep { !defined($_) || ref($_) || !/\A[a-z0-9._-]+\z/ } @{$m->{requires}};
        die "REGISTRY_RISK\n" unless ($m->{risk}||'') =~ /\A(?:observe|network|mutation|stress)\z/;
    }
    return bless {data => $data, hash => sha256_hex(JSON::PP->new->canonical->utf8->encode($data))}, $class;
}
sub data { $_[0]{data} }
sub hash { $_[0]{hash} }
sub resolve {
    my ($self, $facts) = @_;
    my @matches;
    for my $r (@{$self->{data}{rules}}) {
        my $yes = 1;
        for my $key (keys %{$r->{match}}) {
            my $expected = $r->{match}{$key};
            $yes = 0 if $expected ne '*' && (!defined($facts->{$key}) || $facts->{$key} ne $expected);
        }
        push @matches, $r if $yes;
    }
    @matches = sort { $b->{priority} <=> $a->{priority} } @matches;
    return {state => 'UNKNOWN', id => 'unknown-observe', evidence => 'RULES_ONLY'} unless @matches;
    return {state => 'AMBIGUOUS', id => undef, candidates => [map {$_->{id}} grep {$_->{priority} == $matches[0]{priority}} @matches], evidence => 'RULES_ONLY'}
        if @matches > 1 && $matches[0]{priority} == $matches[1]{priority};
    return {state => 'MATCHED', id => $matches[0]{id}, evidence => 'RULES_ONLY', hardware_validation => 'NOT_VALIDATED'};
}
sub device {
    my ($self, $model) = @_;
    my @rows = grep { $_->{model_identifier} eq $model } @{$self->{data}{devices}};
    return {state => 'UNKNOWN', candidates => []} unless @rows;
    return {state => @rows == 1 ? 'DOCUMENTED' : 'AMBIGUOUS', candidates => \@rows};
}
sub plan {
    my ($self, $snapshot, %opts) = @_;
    die "SNAPSHOT_SCHEMA\n" unless ($snapshot->{schema}||'') eq 'macdiag.profile.v1' && ref($snapshot->{facts}) eq 'HASH' && ref($snapshot->{capabilities}) eq 'HASH';
    my $selection = $self->resolve($snapshot->{facts});
    my @items;
    my %implemented = map {$_ => 1} qw(system.inventory tools.inventory network.routes network.dns network.internet network.ip service.inventory);
    for my $m (@{$self->{data}{modules}}) {
        my ($state, $reason) = ('AVAILABLE','REQUIREMENTS_SATISFIED');
        if (!$implemented{$m->{id}}) { ($state,$reason) = ('BLOCKED','NOT_IMPLEMENTED') }
        elsif ($selection->{state} eq 'AMBIGUOUS') { ($state,$reason) = ('BLOCKED','PROFILE_AMBIGUOUS') }
        elsif (($opts{policy}||'observe') eq 'observe' && $m->{risk} ne 'observe') { ($state,$reason) = ('BLOCKED','POLICY_OBSERVE') }
        elsif ($m->{risk} eq 'network' && ($snapshot->{facts}{environment}||'unknown') eq 'unknown') { ($state,$reason) = ('BLOCKED','ENVIRONMENT_UNKNOWN') }
        elsif ($m->{risk} eq 'network' && !$opts{allow_network}) { ($state,$reason) = ('BLOCKED','NETWORK_CONSENT_REQUIRED') }
        elsif ($m->{risk} =~ /\A(?:mutation|stress)\z/) { ($state,$reason) = ('BLOCKED','RISK_NOT_ALLOWED') }
        else {
            for my $cap (@{$m->{requires}}) {
                my $c = $snapshot->{capabilities}{$cap};
                if (ref($c) ne 'HASH' || ($c->{state}||'') ne 'VERIFIED') {
                    ($state,$reason) = ('SKIP','CAPABILITY_UNVERIFIED:' . $cap); last;
                }
            }
        }
        push @items, {id => $m->{id}, risk => $m->{risk}, state => $state, reason => $reason, requires => $m->{requires}, evidence => 'PLAN_NOT_EXECUTION'};
    }
    return {schema => 'macdiag.plan.v1', registry_sha256 => $self->hash, selection => $selection, source => $opts{offline} ? 'SAVED_SNAPSHOT_UNTRUSTED' : 'LIVE_SNAPSHOT', items => \@items};
}
1;
